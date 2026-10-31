import { Router } from 'express';
import crypto from 'node:crypto';
import sql from 'mssql';
import { z } from 'zod';
import { getPool } from '../database.js';
import { requireUser } from './auth.js';

export const customerRouter = Router();
const cartItemSchema = z.object({ productId: z.string().trim().min(1).max(160), quantity: z.coerce.number().int().min(1).max(99) });
const addressSchema = z.object({
  recipientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/),
  line1: z.string().trim().min(2).max(200),
  line2: z.string().trim().max(200).optional().default(''),
  locality: z.string().trim().min(2).max(120),
  landmark: z.string().trim().max(120).optional().default(''),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  pin: z.string().trim().regex(/^[1-9]\d{5}$/),
  type: z.enum(['home', 'work', 'other']).default('home'),
  isDefault: z.boolean().default(false)
});
const orderSchema = z.object({
  addressId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(100),
  paymentMethod: z.enum(['cod', 'online']).default('cod')
});
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

async function getCart(pool, userId, executor = pool) {
  const result = await executor.request().input('userId', sql.UniqueIdentifier, userId).query(`
    SELECT c.cart_id,ci.product_id,ci.quantity,p.slug,p.sku,p.name,p.price,
      img.image_url AS image,COALESCE(i.quantity_on_hand-i.quantity_reserved,0) AS availableQuantity
    FROM dbo.Carts c
    INNER JOIN dbo.CartItems ci ON ci.cart_id=c.cart_id
    INNER JOIN dbo.Products p ON p.product_id=ci.product_id
    LEFT JOIN dbo.Inventory i ON i.product_id=p.product_id
    OUTER APPLY (SELECT TOP (1) image_url FROM dbo.ProductImages
      WHERE product_id=p.product_id ORDER BY is_primary DESC,display_order,created_at) img
    WHERE c.user_id=@userId AND c.cart_status='active'
    ORDER BY ci.added_at`);
  return result.recordset;
}
async function ensureCart(pool, userId) {
  const found = await pool.request().input('userId', sql.UniqueIdentifier, userId)
    .query("SELECT TOP (1) cart_id FROM dbo.Carts WHERE user_id=@userId AND cart_status='active'");
  if (found.recordset[0]) return found.recordset[0].cart_id;
  try {
    return (await pool.request().input('userId', sql.UniqueIdentifier, userId)
      .query('INSERT dbo.Carts(user_id) OUTPUT INSERTED.cart_id VALUES(@userId)')).recordset[0].cart_id;
  } catch (error) {
    if (error.number !== 2601 && error.number !== 2627) throw error;
    return (await pool.request().input('userId', sql.UniqueIdentifier, userId)
      .query("SELECT TOP (1) cart_id FROM dbo.Carts WHERE user_id=@userId AND cart_status='active'")).recordset[0].cart_id;
  }
}
async function ensureWishlist(pool, userId) {
  const found = await pool.request().input('userId', sql.UniqueIdentifier, userId)
    .query('SELECT TOP (1) wishlist_id FROM dbo.Wishlists WHERE user_id=@userId');
  if (found.recordset[0]) return found.recordset[0].wishlist_id;
  try {
    return (await pool.request().input('userId', sql.UniqueIdentifier, userId)
      .query('INSERT dbo.Wishlists(user_id) OUTPUT INSERTED.wishlist_id VALUES(@userId)')).recordset[0].wishlist_id;
  } catch (error) {
    if (error.number !== 2601 && error.number !== 2627) throw error;
    return (await pool.request().input('userId', sql.UniqueIdentifier, userId)
      .query('SELECT TOP (1) wishlist_id FROM dbo.Wishlists WHERE user_id=@userId')).recordset[0].wishlist_id;
  }
}

customerRouter.get('/me', requireUser, (req, res) => res.json({
  data: { user: { id: req.user.user_id, fullName: req.user.full_name, email: req.user.email, phone: req.user.phone_e164 } }
}));

customerRouter.get('/cart', requireUser, async (req, res, next) => {
  try { res.json({ data: await getCart(await getPool(), req.user.user_id) }); } catch (error) { next(error); }
});
customerRouter.put('/cart/items', requireUser, async (req, res, next) => {
  const parsed = cartItemSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_CART_ITEM', 'Product and quantity are required.');
  try {
    const pool = await getPool();
    const product = (await pool.request().input('id', sql.VarChar(160), parsed.data.productId).query(`
      SELECT TOP (1) p.product_id,COALESCE(i.quantity_on_hand-i.quantity_reserved,0) AS available
      FROM dbo.Products p LEFT JOIN dbo.Inventory i ON i.product_id=p.product_id
      WHERE (p.slug=@id OR CONVERT(varchar(36),p.product_id)=@id) AND p.product_status='active'`)).recordset[0];
    if (!product) return fail(res, 404, 'PRODUCT_NOT_FOUND', 'This product is unavailable.');
    if (parsed.data.quantity > product.available) return fail(res, 409, 'INSUFFICIENT_STOCK', 'The requested quantity is not available.');
    const cartId = await ensureCart(pool, req.user.user_id);
    await pool.request().input('cartId', sql.UniqueIdentifier, cartId).input('productId', sql.UniqueIdentifier, product.product_id)
      .input('quantity', sql.Int, parsed.data.quantity).query(`
        UPDATE dbo.CartItems SET quantity=@quantity WHERE cart_id=@cartId AND product_id=@productId;
        IF @@ROWCOUNT=0 INSERT dbo.CartItems(cart_id,product_id,quantity) VALUES(@cartId,@productId,@quantity);`);
    res.json({ data: await getCart(pool, req.user.user_id) });
  } catch (error) { next(error); }
});
customerRouter.delete('/cart/items/:id', requireUser, async (req, res, next) => {
  try {
    const pool = await getPool();
    await pool.request().input('userId', sql.UniqueIdentifier, req.user.user_id).input('id', sql.VarChar(160), req.params.id)
      .query(`DELETE ci FROM dbo.CartItems ci
        INNER JOIN dbo.Carts c ON c.cart_id=ci.cart_id
        INNER JOIN dbo.Products p ON p.product_id=ci.product_id
        WHERE c.user_id=@userId AND c.cart_status='active'
          AND (p.slug=@id OR CONVERT(varchar(36),p.product_id)=@id)`);
    res.json({ data: await getCart(pool, req.user.user_id) });
  } catch (error) { next(error); }
});

customerRouter.get('/addresses', requireUser, async (req, res, next) => {
  try {
    const result = await (await getPool()).request().input('userId', sql.UniqueIdentifier, req.user.user_id).query(`
      SELECT address_id AS id,recipient_name AS recipientName,phone_e164 AS phone,
        address_line1 AS line1,address_line2 AS line2,locality,landmark,city,
        state_region AS state,postal_code AS pin,address_type AS type,is_default AS isDefault
      FROM dbo.Addresses WHERE user_id=@userId ORDER BY is_default DESC,created_at DESC`);
    res.json({ data: result.recordset });
  } catch (error) { next(error); }
});
customerRouter.post('/addresses', requireUser, async (req, res, next) => {
  const parsed = addressSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_ADDRESS', 'Check the delivery address fields.');
  const a = parsed.data;
  try {
    const pool = await getPool(), tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const count = (await new sql.Request(tx).input('u', sql.UniqueIdentifier, req.user.user_id)
        .query('SELECT COUNT_BIG(1) AS total FROM dbo.Addresses WHERE user_id=@u')).recordset[0].total;
      const makeDefault = a.isDefault || Number(count) === 0;
      if (makeDefault) await new sql.Request(tx).input('u', sql.UniqueIdentifier, req.user.user_id)
        .query('UPDATE dbo.Addresses SET is_default=0 WHERE user_id=@u');
      const result = await new sql.Request(tx)
        .input('u', sql.UniqueIdentifier, req.user.user_id).input('name', sql.NVarChar(120), a.recipientName)
        .input('phone', sql.VarChar(16), '+91' + a.phone).input('line1', sql.NVarChar(200), a.line1)
        .input('line2', sql.NVarChar(200), a.line2 || null).input('locality', sql.NVarChar(120), a.locality)
        .input('landmark', sql.NVarChar(120), a.landmark || null).input('city', sql.NVarChar(100), a.city)
        .input('state', sql.NVarChar(100), a.state).input('pin', sql.VarChar(12), a.pin)
        .input('type', sql.VarChar(20), a.type).input('isDefault', sql.Bit, makeDefault)
        .query(`INSERT dbo.Addresses(user_id,recipient_name,phone_e164,address_line1,address_line2,locality,landmark,city,state_region,postal_code,address_type,is_default)
          OUTPUT INSERTED.address_id AS id,INSERTED.recipient_name AS recipientName,INSERTED.phone_e164 AS phone,
          INSERTED.address_line1 AS line1,INSERTED.address_line2 AS line2,INSERTED.locality,INSERTED.landmark,
          INSERTED.city,INSERTED.state_region AS state,INSERTED.postal_code AS pin,INSERTED.address_type AS type,
          INSERTED.is_default AS isDefault
          VALUES(@u,@name,@phone,@line1,@line2,@locality,@landmark,@city,@state,@pin,@type,@isDefault)`);
      await tx.commit();
      res.status(201).json({ data: result.recordset[0] });
    } catch (error) { await tx.rollback(); throw error; }
  } catch (error) { next(error); }
});
customerRouter.put('/addresses/:id', requireUser, async (req, res, next) => {
  const parsed = addressSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_ADDRESS', 'Check the delivery address fields.');
  const a = parsed.data;
  try {
    const pool = await getPool(), tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      if (a.isDefault) await new sql.Request(tx).input('u', sql.UniqueIdentifier, req.user.user_id)
        .query('UPDATE dbo.Addresses SET is_default=0 WHERE user_id=@u');
      const result = await new sql.Request(tx)
        .input('u', sql.UniqueIdentifier, req.user.user_id).input('id', sql.UniqueIdentifier, req.params.id)
        .input('name', sql.NVarChar(120), a.recipientName).input('phone', sql.VarChar(16), '+91' + a.phone)
        .input('line1', sql.NVarChar(200), a.line1).input('line2', sql.NVarChar(200), a.line2 || null)
        .input('locality', sql.NVarChar(120), a.locality).input('landmark', sql.NVarChar(120), a.landmark || null)
        .input('city', sql.NVarChar(100), a.city).input('state', sql.NVarChar(100), a.state)
        .input('pin', sql.VarChar(12), a.pin).input('type', sql.VarChar(20), a.type).input('isDefault', sql.Bit, a.isDefault)
        .query(`UPDATE dbo.Addresses SET recipient_name=@name,phone_e164=@phone,address_line1=@line1,
          address_line2=@line2,locality=@locality,landmark=@landmark,city=@city,state_region=@state,
          postal_code=@pin,address_type=@type,is_default=@isDefault,updated_at=SYSUTCDATETIME()
          OUTPUT INSERTED.address_id AS id,INSERTED.recipient_name AS recipientName,INSERTED.phone_e164 AS phone,
          INSERTED.address_line1 AS line1,INSERTED.address_line2 AS line2,INSERTED.locality,INSERTED.landmark,
          INSERTED.city,INSERTED.state_region AS state,INSERTED.postal_code AS pin,INSERTED.address_type AS type,
          INSERTED.is_default AS isDefault
          WHERE address_id=@id AND user_id=@u`);
      if (!result.recordset[0]) { await tx.rollback(); return fail(res, 404, 'ADDRESS_NOT_FOUND', 'Saved address not found.'); }
      await tx.commit();
      res.json({ data: result.recordset[0] });
    } catch (error) { await tx.rollback(); throw error; }
  } catch (error) { next(error); }
});
customerRouter.delete('/addresses/:id', requireUser, async (req, res, next) => {
  try {
    const pool = await getPool(), tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const deleted = await new sql.Request(tx).input('u', sql.UniqueIdentifier, req.user.user_id)
        .input('id', sql.UniqueIdentifier, req.params.id)
        .query('DELETE dbo.Addresses OUTPUT DELETED.is_default AS wasDefault WHERE address_id=@id AND user_id=@u');
      if (!deleted.recordset.length) { await tx.rollback(); return fail(res, 404, 'ADDRESS_NOT_FOUND', 'Saved address not found.'); }
      if (deleted.recordset[0].wasDefault) {
        await new sql.Request(tx).input('u', sql.UniqueIdentifier, req.user.user_id)
          .query(`UPDATE dbo.Addresses SET is_default=1,updated_at=SYSUTCDATETIME()
            WHERE address_id=(SELECT TOP (1) address_id FROM dbo.Addresses WHERE user_id=@u ORDER BY created_at DESC)`);
      }
      await tx.commit();
      res.json({ data: { deleted: true } });
    } catch (error) { await tx.rollback(); throw error; }
  } catch (error) { next(error); }
});

customerRouter.get('/wishlist', requireUser, async (req, res, next) => {
  try {
    const result = await (await getPool()).request().input('u', sql.UniqueIdentifier, req.user.user_id).query(`
      SELECT p.slug AS productId,p.name,p.price
      FROM dbo.Wishlists w INNER JOIN dbo.WishlistItems wi ON wi.wishlist_id=w.wishlist_id
      INNER JOIN dbo.Products p ON p.product_id=wi.product_id WHERE w.user_id=@u ORDER BY wi.added_at DESC`);
    res.json({ data: result.recordset });
  } catch (error) { next(error); }
});
customerRouter.put('/wishlist/:id', requireUser, async (req, res, next) => {
  try {
    const pool = await getPool();
    const product = (await pool.request().input('id', sql.VarChar(160), req.params.id)
      .query("SELECT TOP (1) product_id FROM dbo.Products WHERE slug=@id AND product_status='active'")).recordset[0];
    if (!product) return fail(res, 404, 'PRODUCT_NOT_FOUND', 'This product is unavailable.');
    const wishlistId = await ensureWishlist(pool, req.user.user_id);
    await pool.request().input('w', sql.UniqueIdentifier, wishlistId).input('p', sql.UniqueIdentifier, product.product_id)
      .query('IF NOT EXISTS(SELECT 1 FROM dbo.WishlistItems WHERE wishlist_id=@w AND product_id=@p) INSERT dbo.WishlistItems(wishlist_id,product_id) VALUES(@w,@p)');
    res.status(204).end();
  } catch (error) { next(error); }
});
customerRouter.delete('/wishlist/:id', requireUser, async (req, res, next) => {
  try {
    await (await getPool()).request().input('u', sql.UniqueIdentifier, req.user.user_id).input('id', sql.VarChar(160), req.params.id)
      .query(`DELETE wi FROM dbo.WishlistItems wi INNER JOIN dbo.Wishlists w ON w.wishlist_id=wi.wishlist_id
        INNER JOIN dbo.Products p ON p.product_id=wi.product_id WHERE w.user_id=@u AND p.slug=@id`);
    res.status(204).end();
  } catch (error) { next(error); }
});

customerRouter.get('/orders', requireUser, async (req, res, next) => {
  try {
    const result = await (await getPool()).request().input('u', sql.UniqueIdentifier, req.user.user_id).query(`
      SELECT o.order_id AS id,o.order_number AS orderNumber,o.order_status AS status,
        o.grand_total AS total,o.placed_at AS placedAt,
        JSON_QUERY((SELECT oi.product_name_snapshot AS name,oi.sku_snapshot AS sku,
          oi.quantity AS qty,oi.unit_price AS price,oi.image_url_snapshot AS image
          FROM dbo.OrderItems oi WHERE oi.order_id=o.order_id FOR JSON PATH)) AS itemsJson
      FROM dbo.Orders o WHERE o.user_id=@u ORDER BY o.placed_at DESC`);
    res.json({ data: result.recordset.map(row => ({ ...row, items: row.itemsJson ? JSON.parse(row.itemsJson) : [] })) });
  } catch (error) { next(error); }
});

customerRouter.post('/orders', requireUser, async (req, res, next) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_ORDER', 'A saved address and valid idempotency key are required.');
  if (parsed.data.paymentMethod === 'online') {
    return fail(res, 503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Online payment is not enabled yet. Choose Cash on Delivery or configure a payment gateway.');
  }
  let tx;
  try {
    const pool = await getPool();
    tx = new sql.Transaction(pool);
    await tx.begin();
    const duplicate = (await new sql.Request(tx).input('key', sql.VarChar(100), parsed.data.idempotencyKey)
      .input('u', sql.UniqueIdentifier, req.user.user_id)
      .query(`SELECT TOP (1) o.order_id AS id,o.order_number AS orderNumber,o.order_status AS status,
        o.grand_total AS total,o.placed_at AS placedAt
        FROM dbo.Orders o INNER JOIN dbo.PaymentTransactions p ON p.order_id=o.order_id
        WHERE p.idempotency_key=@key AND o.user_id=@u`)).recordset[0];
    if (duplicate) {
      await tx.commit();
      return res.json({ data: duplicate, idempotent: true });
    }
    const address = (await new sql.Request(tx).input('u', sql.UniqueIdentifier, req.user.user_id)
      .input('a', sql.UniqueIdentifier, parsed.data.addressId)
      .query('SELECT TOP (1) * FROM dbo.Addresses WHERE user_id=@u AND address_id=@a')).recordset[0];
    if (!address) { await tx.rollback(); return fail(res, 400, 'INVALID_ADDRESS', 'Select one of your saved delivery addresses.'); }
    const items = await getCart(pool, req.user.user_id, tx);
    if (!items.length) { await tx.rollback(); return fail(res, 400, 'EMPTY_CART', 'Your bag is empty.'); }
    const subtotal = items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
    const shipping = subtotal >= 1499 ? 0 : 99;
    const total = subtotal + shipping;
    const orderNumber = 'CLV-' + new Date().getFullYear() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const created = await new sql.Request(tx)
      .input('number', sql.VarChar(40), orderNumber).input('u', sql.UniqueIdentifier, req.user.user_id)
      .input('subtotal', sql.Decimal(12, 2), subtotal).input('shipping', sql.Decimal(12, 2), shipping)
      .input('total', sql.Decimal(12, 2), total).input('address', sql.NVarChar(sql.MAX), JSON.stringify(address))
      .query(`INSERT dbo.Orders(order_number,user_id,order_status,subtotal,shipping_total,grand_total,shipping_address_snapshot)
        OUTPUT INSERTED.order_id AS id,INSERTED.order_number AS orderNumber,INSERTED.order_status AS status,
          INSERTED.grand_total AS total,INSERTED.placed_at AS placedAt
        VALUES(@number,@u,'processing',@subtotal,@shipping,@total,@address)`);
    const order = created.recordset[0];
    for (const item of items) {
      const stock = await new sql.Request(tx).input('p', sql.UniqueIdentifier, item.product_id)
        .input('q', sql.Int, item.quantity)
        .query('UPDATE dbo.Inventory SET quantity_on_hand=quantity_on_hand-@q,updated_at=SYSUTCDATETIME() WHERE product_id=@p AND quantity_on_hand-quantity_reserved>=@q');
      if (!stock.rowsAffected[0]) {
        const error = new Error('Stock changed while checking out. Review your bag and try again.');
        error.apiCode = 'INSUFFICIENT_STOCK';
        throw error;
      }
      await new sql.Request(tx).input('o', sql.UniqueIdentifier, order.id).input('p', sql.UniqueIdentifier, item.product_id)
        .input('sku', sql.VarChar(60), item.sku).input('name', sql.NVarChar(160), item.name)
        .input('image', sql.NVarChar(2048), item.image).input('price', sql.Decimal(12, 2), item.price)
        .input('q', sql.Int, item.quantity).input('line', sql.Decimal(12, 2), Number(item.price) * item.quantity)
        .query('INSERT dbo.OrderItems(order_id,product_id,sku_snapshot,product_name_snapshot,image_url_snapshot,unit_price,quantity,line_total) VALUES(@o,@p,@sku,@name,@image,@price,@q,@line)');
      await new sql.Request(tx).input('p', sql.UniqueIdentifier, item.product_id).input('q', sql.Int, -item.quantity)
        .input('order', sql.UniqueIdentifier, order.id)
        .query("INSERT dbo.InventoryMovements(product_id,quantity_delta,movement_type,reference_type,reference_id,notes) VALUES(@p,@q,'sale','order',@order,'Cash on delivery order')");
    }
    await new sql.Request(tx).input('o', sql.UniqueIdentifier, order.id).input('amount', sql.Decimal(12, 2), total)
      .input('key', sql.VarChar(100), parsed.data.idempotencyKey)
      .query("INSERT dbo.PaymentTransactions(order_id,provider,amount,payment_status,idempotency_key,payment_method) VALUES(@o,'cash_on_delivery',@amount,'pending',@key,'cash_on_delivery')");
    await new sql.Request(tx).input('u', sql.UniqueIdentifier, req.user.user_id)
      .query("UPDATE dbo.Carts SET cart_status='converted',updated_at=SYSUTCDATETIME() WHERE user_id=@u AND cart_status='active'");
    await tx.commit();
    res.status(201).json({ data: { ...order, paymentStatus: 'pending', paymentMethod: 'cash_on_delivery', items: items.map(item => ({ name: item.name, sku: item.sku, qty: item.quantity, price: item.price, image: item.image })) } });
  } catch (error) {
    if (tx) { try { await tx.rollback(); } catch {} }
    if (error.apiCode === 'INSUFFICIENT_STOCK') return fail(res, 409, error.apiCode, error.message);
    if (error.number === 2601 || error.number === 2627) return fail(res, 409, 'DUPLICATE_ORDER', 'This checkout request was already processed. Refresh your order history.');
    next(error);
  }
});
