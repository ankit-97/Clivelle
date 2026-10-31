import { Router } from 'express';
import sql from 'mssql/msnodesqlv8.js';
import { z } from 'zod';
import { getPool } from '../database.js';

export const catalogRouter = Router();

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  category: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().max(100).optional(),
  featured: z.enum(['true', 'false']).optional()
});

catalogRouter.get('/categories', async (_req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT category_id AS id, name, slug, display_order
      FROM dbo.Categories
      WHERE is_active = 1
      ORDER BY display_order, name;
    `);
    res.json({ data: result.recordset });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/products', async (req, res, next) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: 'INVALID_QUERY', message: 'Invalid catalog filters.', details: parsed.error.flatten().fieldErrors }
    });
  }

  try {
    const { page, limit, category, search, featured } = parsed.data;
    const pool = await getPool();
    const request = pool.request()
      .input('offset', sql.Int, (page - 1) * limit)
      .input('limit', sql.Int, limit);

    const filters = [`p.product_status = 'active'`, 'c.is_active = 1'];
    if (category) {
      request.input('category', sql.VarChar(100), category);
      filters.push('c.slug = @category');
    }
    if (search) {
      request.input('search', sql.NVarChar(204), `%${search}%`);
      filters.push('(p.name LIKE @search OR p.description LIKE @search)');
    }
    if (featured !== undefined) {
      request.input('featured', sql.Bit, featured === 'true');
      filters.push('p.is_featured = @featured');
    }

    const where = filters.join(' AND ');
    const result = await request.query(`
      SELECT
        p.product_id AS id,
        p.sku,
        p.slug,
        p.name,
        p.description,
        p.colour,
        p.price,
        p.compare_at_price AS compareAtPrice,
        p.is_featured AS isFeatured,
        c.name AS category,
        c.slug AS categorySlug,
        COALESCE(i.quantity_on_hand - i.quantity_reserved, 0) AS availableQuantity,
        img.image_url AS image,
        img.alt_text AS imageAlt
      FROM dbo.Products p
      INNER JOIN dbo.Categories c ON c.category_id = p.category_id
      LEFT JOIN dbo.Inventory i ON i.product_id = p.product_id
      OUTER APPLY (
        SELECT TOP (1) image_url, alt_text
        FROM dbo.ProductImages
        WHERE product_id = p.product_id
        ORDER BY is_primary DESC, display_order, created_at
      ) img
      WHERE ${where}
      ORDER BY p.is_featured DESC, p.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;

      SELECT COUNT_BIG(1) AS total
      FROM dbo.Products p
      INNER JOIN dbo.Categories c ON c.category_id = p.category_id
      WHERE ${where};
    `);

    const total = Number(result.recordsets[1][0].total);
    res.json({
      data: result.recordsets[0],
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
});
