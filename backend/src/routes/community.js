import { Router } from 'express';
import sql from 'mssql';
import { z } from 'zod';
import { getPool } from '../database.js';
import { requireUser } from './auth.js';

export const communityRouter = Router();
const newsletterSchema = z.object({ email: z.string().trim().email().max(254) });
const reviewSchema = z.object({
  productId: z.string().trim().min(1).max(160),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional().default(''),
  message: z.string().trim().min(5).max(1000)
});

communityRouter.post('/newsletter', async (req, res, next) => {
  const parsed = newsletterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' } });
  try {
    const pool = await getPool(), email = parsed.data.email.toLowerCase();
    const existing = await pool.request().input('email', sql.NVarChar(254), email)
      .query('SELECT TOP (1) subscriber_id,subscription_status FROM dbo.NewsletterSubscribers WHERE email=@email');
    if (existing.recordset[0]) {
      await pool.request().input('email', sql.NVarChar(254), email)
        .query("UPDATE dbo.NewsletterSubscribers SET subscription_status='subscribed',unsubscribed_at=NULL WHERE email=@email");
      return res.json({ data: { subscribed: true, alreadySubscribed: existing.recordset[0].subscription_status === 'subscribed' } });
    }
    await pool.request().input('email', sql.NVarChar(254), email)
      .query("INSERT dbo.NewsletterSubscribers(email,subscription_status) VALUES(@email,'subscribed')");
    res.status(201).json({ data: { subscribed: true } });
  } catch (error) {
    if (error.number === 2601 || error.number === 2627) return res.json({ data: { subscribed: true, alreadySubscribed: true } });
    next(error);
  }
});

communityRouter.get('/reviews', async (req, res, next) => {
  try {
    const pool = await getPool(), request = pool.request();
    let filter = "r.review_status='published'";
    if (req.query.productId) {
      request.input('productId', sql.VarChar(160), String(req.query.productId).slice(0, 160));
      filter += ' AND p.slug=@productId';
    }
    const result = await request.query(`
      SELECT TOP (100) r.review_id AS id,p.slug AS productId,p.name AS productName,
        r.rating,r.review_title AS title,r.review_text AS message,
        u.full_name AS customerName,r.created_at AS createdAt
      FROM dbo.Reviews r INNER JOIN dbo.Products p ON p.product_id=r.product_id
      INNER JOIN dbo.Users u ON u.user_id=r.user_id
      WHERE ${filter} ORDER BY r.created_at DESC`);
    res.json({ data: result.recordset });
  } catch (error) { next(error); }
});

communityRouter.post('/reviews', requireUser, async (req, res, next) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_REVIEW', message: 'Choose a product, rating and review of at least five characters.' } });
  try {
    const pool = await getPool(), data = parsed.data;
    const product = (await pool.request().input('slug', sql.VarChar(160), data.productId)
      .query("SELECT TOP (1) product_id FROM dbo.Products WHERE slug=@slug AND product_status='active'")).recordset[0];
    if (!product) return res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'This product is unavailable.' } });
    const result = await pool.request().input('user', sql.UniqueIdentifier, req.user.user_id)
      .input('product', sql.UniqueIdentifier, product.product_id).input('rating', sql.TinyInt, data.rating)
      .input('title', sql.NVarChar(120), data.title || null).input('message', sql.NVarChar(1000), data.message)
      .query(`INSERT dbo.Reviews(user_id,product_id,rating,review_title,review_text,review_status)
        OUTPUT INSERTED.review_id AS id,INSERTED.rating,INSERTED.review_title AS title,
          INSERTED.review_text AS message,INSERTED.created_at AS createdAt
        VALUES(@user,@product,@rating,@title,@message,'pending')`);
    res.status(201).json({ data: { ...result.recordset[0], status: 'pending' } });
  } catch (error) { next(error); }
});
