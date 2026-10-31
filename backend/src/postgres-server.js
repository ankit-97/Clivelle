import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet());
const origins = (process.env.CORS_ORIGINS || 'https://ankit-97.github.io,https://clivelle.onrender.com,http://localhost:4173,http://127.0.0.1:4173,http://localhost:5500').split(',').map(x => x.trim()).filter(Boolean);
app.use(cors({ origin(origin, cb) { if (!origin || origins.includes(origin)) return cb(null, true); return cb(new Error('Origin is not allowed by CORS')); }, credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','Idempotency-Key'] }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the PostgreSQL deployment.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }, max: Number(process.env.DB_POOL_MAX || 10), idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });

const schema = `
CREATE TABLE IF NOT EXISTS users (
 user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE, phone text UNIQUE,
 full_name text NOT NULL, password_hash text NOT NULL, account_status text NOT NULL DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 token_hash char(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS products (
 product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, name text NOT NULL,
 category text NOT NULL, price numeric(12,2) NOT NULL CHECK(price >= 0),
 compare_at_price numeric(12,2) NOT NULL CHECK(compare_at_price >= price),
 colour text, image text, available_quantity integer NOT NULL DEFAULT 12 CHECK(available_quantity >= 0),
 description text, is_featured boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS carts (
 cart_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS carts_one_active_per_user ON carts(user_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS cart_items (
 cart_id uuid NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE, product_slug text NOT NULL REFERENCES products(slug),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cart_id,product_slug)
);
CREATE TABLE IF NOT EXISTS addresses (
 address_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 recipient_name text NOT NULL, phone text NOT NULL, line1 text NOT NULL, locality text NOT NULL,
 city text NOT NULL, state text NOT NULL, pin text NOT NULL, type text NOT NULL DEFAULT 'home',
 is_default boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS addresses_user_idx ON addresses(user_id);
CREATE TABLE IF NOT EXISTS orders (
 order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number text UNIQUE NOT NULL,
 user_id uuid NOT NULL REFERENCES users(user_id), status text NOT NULL,
 subtotal numeric(12,2) NOT NULL, shipping numeric(12,2) NOT NULL, total numeric(12,2) NOT NULL,
 address_snapshot jsonb NOT NULL, items_snapshot jsonb NOT NULL,
 idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
`;

async function init() {
 await pool.query(schema);
 // Migrate any cart table created by an intermediate UUID-product build to stable product slugs.
 await pool.query(`DO $ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='cart_items' AND column_name='product_id') THEN
   ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS product_slug text;
   UPDATE cart_items ci SET product_slug=p.slug FROM products p WHERE ci.product_slug IS NULL AND p.product_id::text=ci.product_id::text;
   ALTER TABLE cart_items ALTER COLUMN product_slug SET NOT NULL;
   ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_pkey;
   ALTER TABLE cart_items DROP COLUMN product_id;
   ALTER TABLE cart_items ADD PRIMARY KEY(cart_id,product_slug);
   ALTER TABLE cart_items ADD CONSTRAINT cart_items_product_slug_fkey FOREIGN KEY(product_slug) REFERENCES products(slug);
  END IF;
 END $;`);
 // Upgrade the earlier lightweight PostgreSQL schema in place without dropping customer or catalogue data.
 await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active';
 ALTER TABLE users ALTER COLUMN user_id SET DEFAULT gen_random_uuid();
 ALTER TABLE products ADD COLUMN IF NOT EXISTS description text;
 ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
 ALTER TABLE products ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;`);
 const count = await pool.query('SELECT count(*)::int AS n FROM products');
 if (!count.rows[0].n) {
  await pool.query(`INSERT INTO products(slug,name,category,price,compare_at_price,colour,image,is_featured) VALUES
  ('rosewood-claw','Pastel Butterfly Claw Clip','Claw clips',299,399,'Pastel mix','rosewood-claw.jpg',true),
  ('mauve-claw','Minimal Square Claw Clip','Claw clips',299,399,'Mauve','mauve-claw.jpg',false),
  ('marigold-barrette','Pearl Hair Clip Set','Hair clips',349,499,'Pearl','marigold-barrette.jpg',true),
  ('pearl-headband','Floral Hair Band','Hairbands',399,549,'Navy & pink','pearl-headband.jpg',false),
  ('petal-clip','Crystal Hair Clip','Hair clips',349,499,'Gold','petal-clip.jpg',false),
  ('ribbon-scrunchie','Satin Scrunchie Set (4 pcs)','Scrunchies',499,699,'Pastel mix','ribbon-scrunchie.jpg',true),
  ('cloud-scrunchie','Cloud Soft Scrunchie','Scrunchies',129,199,'Ivory','cloud-scrunchie.jpg',false),
  ('sunday-headband','Sunday Comfort Headband','Hairbands',269,399,'Blush','sunday-headband.jpg',false)`);
 }
}
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const publicUser = u => ({ id: u.user_id, user_id: u.user_id, fullName: u.full_name, name: u.full_name, email: u.email, phone: u.phone });
function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
async function auth(req,res,next) {
 try {
  const h = req.headers.authorization || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const cookie = req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('clivelle_session='))?.slice(17) || '';
  const token = bearer || cookie;
  if (!token) return fail(res,401,'AUTH_REQUIRED','Sign in is required.');
  const r = await pool.query(`SELECT u.user_id,u.full_name,u.email,u.phone FROM auth_sessions s JOIN users u USING(user_id) WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.account_status='active'`,[tokenHash(token)]);
  if (!r.rowCount) return fail(res,401,'AUTH_REQUIRED','Your session has expired. Please sign in again.');
  req.user=r.rows[0]; req.tokenHash=tokenHash(token); next();
 } catch(e){next(e)}
}
function issueSession(res,user) {
 const token=crypto.randomBytes(32).toString('base64url');
 return pool.query('INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'30 days\')',[user.user_id,tokenHash(token)]).then(()=>{
  res.setHeader('Set-Cookie',`clivelle_session=${token}; Max-Age=2592000; Path=/; HttpOnly; SameSite=None; Secure`);
  return { token, user: publicUser(user) };
 });
}
app.get('/health/live',(_q,res)=>res.json({status:'ok',service:'clivelle-api'}));
app.get('/health',async(_q,res)=>{try{await pool.query('SELECT 1');res.json({status:'ready',database:'postgres'})}catch{res.status(503).json({status:'not_ready',database:'unavailable'})}});
app.get('/health/ready',async(_q,res)=>{try{await pool.query('SELECT 1');res.json({status:'ready',database:'connected'})}catch{res.status(503).json({status:'not_ready',database:'unavailable'})}});
app.get('/api/v1',(_q,res)=>res.json({name:'Clivelle API',version:'v1',status:'ready'}));
app.get('/api/v1/products',async(req,res,next)=>{try{const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(48,Math.max(1,Number(req.query.limit)||24));const vals=[],where=['active=true'];if(req.query.category){vals.push(req.query.category);where.push(`category=$${vals.length}`)}if(req.query.search){vals.push('%'+String(req.query.search).slice(0,100)+'%');where.push(`(name ILIKE $${vals.length} OR category ILIKE $${vals.length})`)}const count=await pool.query(`SELECT count(*)::int n FROM products WHERE ${where.join(' AND ')}`,vals);vals.push(limit,(page-1)*limit);const r=await pool.query(`SELECT slug,name,category,price,compare_at_price AS "compareAtPrice",colour,image,available_quantity AS "availableQuantity",description,is_featured AS "isFeatured" FROM products WHERE ${where.join(' AND ')} ORDER BY is_featured DESC,name LIMIT $${vals.length-1} OFFSET $${vals.length}`,vals);res.json({data:r.rows,pagination:{page,limit,total:count.rows[0].n,pages:Math.ceil(count.rows[0].n/limit)}})}catch(e){next(e)}});
app.post('/api/v1/auth/signup',async(req,res,next)=>{try{const {fullName,email,phone,password,confirmPassword}=req.body||{};const name=String(fullName||'').trim(),mail=String(email||'').trim().toLowerCase()||null,ph=String(phone||'').replace(/\D/g,'')||null;if(name.length<2||name.length>120||(!mail&&!ph)|| (mail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) || (ph&&!/^[6-9]\d{9}$/.test(ph)) || typeof password!=='string'||password.length<8||password.length>128||password!==confirmPassword)return fail(res,400,'INVALID_SIGNUP','Check your name, email or phone, and password.');const hash=await bcrypt.hash(password,12);const r=await pool.query('INSERT INTO users(full_name,email,phone,password_hash) VALUES($1,$2,$3,$4) RETURNING user_id,full_name,email,phone',[name,mail,ph?'+91'+ph:null,hash]);const session=await issueSession(res,r.rows[0]);res.status(201).json({data:session})}catch(e){if(e.code==='23505')return fail(res,409,'ACCOUNT_EXISTS','An account already exists with these details. Please sign in instead.');next(e)}});
app.post('/api/v1/auth/signin',async(req,res,next)=>{try{const identifier=String(req.body?.identifier||'').trim().toLowerCase(),password=String(req.body?.password||'');if(identifier.length<3||password.length<8)return fail(res,400,'INVALID_SIGNIN','Enter your email or phone and password.');const phone=identifier.replace(/\D/g,'');const key=identifier.includes('@')?identifier:(phone?'+91'+phone:identifier);const r=await pool.query("SELECT user_id,full_name,email,phone,password_hash FROM users WHERE account_status='active' AND (email=$1 OR phone=$1 OR phone=$2) LIMIT 1",[key,identifier.replace(/\\D/g,'')]);if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return fail(res,401,'INVALID_CREDENTIALS','Email/phone or password is incorrect.');const {password_hash,...u}=r.rows[0];const session=await issueSession(res,u);res.json({data:session})}catch(e){next(e)}});
app.get('/api/v1/auth/me',auth,(req,res)=>res.json({data:{user:publicUser(req.user)}}));
app.post('/api/v1/auth/signout',auth,async(req,res,next)=>{try{await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1',[req.tokenHash]);res.setHeader('Set-Cookie','clivelle_session=; Max-Age=0; Path=/; HttpOnly; SameSite=None; Secure');res.json({data:{signedOut:true}})}catch(e){next(e)}});
app.get('/api/v1/customer/me',auth,(req,res)=>res.json({data:{user:publicUser(req.user)}}));
async function getCart(userId,client=pool){const r=await client.query(`SELECT p.slug,ci.quantity,p.name,p.category,p.price,p.compare_at_price AS "compareAtPrice",p.colour,p.image,p.available_quantity AS "availableQuantity" FROM carts c JOIN cart_items ci USING(cart_id) JOIN products p ON p.slug=ci.product_slug WHERE c.user_id=$1 AND c.status='active' ORDER BY ci.updated_at`,[userId]);return r.rows}
async function activeCart(userId,client=pool){const r=await client.query("INSERT INTO carts(user_id) VALUES($1) ON CONFLICT (user_id) WHERE status='active' DO UPDATE SET updated_at=now() RETURNING cart_id",[userId]);return r.rows[0].cart_id}
app.get('/api/v1/customer/cart',auth,async(req,res,next)=>{try{res.json({data:await getCart(req.user.user_id)})}catch(e){next(e)}});
app.put('/api/v1/customer/cart/items',auth,async(req,res,next)=>{try{const id=String(req.body?.productId||''),qty=Number(req.body?.quantity);if(!id||!Number.isInteger(qty)||qty<1||qty>99)return fail(res,400,'INVALID_CART_ITEM','Product and quantity are required.');const p=await pool.query('SELECT slug,available_quantity FROM products WHERE slug=$1 AND active=true',[id]);if(!p.rowCount)return fail(res,404,'PRODUCT_NOT_FOUND','Product is unavailable.');if(qty>p.rows[0].available_quantity)return fail(res,409,'INSUFFICIENT_STOCK','Requested quantity is not available.');const c=await activeCart(req.user.user_id);await pool.query('INSERT INTO cart_items(cart_id,product_slug,quantity) VALUES($1,$2,$3) ON CONFLICT(cart_id,product_slug) DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=now()',[c,p.rows[0].slug,qty]);res.json({data:await getCart(req.user.user_id)})}catch(e){next(e)}});
app.delete('/api/v1/customer/cart/items/:id',auth,async(req,res,next)=>{try{await pool.query("DELETE FROM cart_items ci USING carts c,products p WHERE ci.cart_id=c.cart_id AND p.slug=ci.product_slug AND c.user_id=$1 AND c.status='active' AND p.slug=$2",[req.user.user_id,req.params.id]);res.json({data:await getCart(req.user.user_id)})}catch(e){next(e)}});
app.get('/api/v1/customer/addresses',auth,async(req,res,next)=>{try{const r=await pool.query('SELECT address_id AS id,recipient_name AS name,recipient_name AS "recipientName",phone,line1 AS street,locality AS area,city,state,pin,type,is_default AS "default" FROM addresses WHERE user_id=$1 ORDER BY is_default DESC,created_at',[req.user.user_id]);res.json({data:r.rows})}catch(e){next(e)}});
app.post('/api/v1/customer/addresses',auth,async(req,res,next)=>{const a=req.body||{};const phone=String(a.phone||'').replace(/\D/g,'');if(String(a.recipientName||a.name||'').trim().length<2||!/^[6-9]\d{9}$/.test(phone)||String(a.line1||a.street||'').trim().length<2||String(a.locality||a.area||'').trim().length<2||!a.city||!a.state||!/^[1-9]\d{5}$/.test(String(a.pin||'')))return fail(res,400,'INVALID_ADDRESS','Check the delivery address.');const client=await pool.connect();try{await client.query('BEGIN');const makeDefault=Boolean(a.isDefault||a.default);if(makeDefault)await client.query('UPDATE addresses SET is_default=false WHERE user_id=$1',[req.user.user_id]);const r=await client.query('INSERT INTO addresses(user_id,recipient_name,phone,line1,locality,city,state,pin,type,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING address_id AS id,recipient_name AS name,phone,line1 AS street,locality AS area,city,state,pin,type,is_default AS "default"',[req.user.user_id,String(a.recipientName||a.name).trim(),phone,String(a.line1||a.street).trim(),String(a.locality||a.area).trim(),String(a.city).trim(),String(a.state).trim(),String(a.pin),a.type||'home',makeDefault]);await client.query('COMMIT');res.status(201).json({data:r.rows[0]})}catch(e){await client.query('ROLLBACK');next(e)}finally{client.release()}});
app.put('/api/v1/customer/addresses/:id',auth,async(req,res,next)=>{const a=req.body||{},phone=String(a.phone||'').replace(/\D/g,'');if(String(a.recipientName||a.name||'').trim().length<2||!/^[6-9]\d{9}$/.test(phone)||String(a.line1||a.street||'').trim().length<2||String(a.locality||a.area||'').trim().length<2||!a.city||!a.state||!/^[1-9]\d{5}$/.test(String(a.pin||'')))return fail(res,400,'INVALID_ADDRESS','Check the delivery address.');const client=await pool.connect();try{await client.query('BEGIN');const makeDefault=Boolean(a.isDefault||a.default);if(makeDefault)await client.query('UPDATE addresses SET is_default=false WHERE user_id=$1',[req.user.user_id]);const r=await client.query('UPDATE addresses SET recipient_name=$1,phone=$2,line1=$3,locality=$4,city=$5,state=$6,pin=$7,type=$8,is_default=$9 WHERE address_id=$10 AND user_id=$11 RETURNING address_id AS id,recipient_name AS name,phone,line1 AS street,locality AS area,city,state,pin,type,is_default AS "default"',[String(a.recipientName||a.name).trim(),phone,String(a.line1||a.street).trim(),String(a.locality||a.area).trim(),String(a.city).trim(),String(a.state).trim(),String(a.pin),a.type||'home',makeDefault,req.params.id,req.user.user_id]);if(!r.rowCount){await client.query('ROLLBACK');return fail(res,404,'ADDRESS_NOT_FOUND','Saved address not found.')}await client.query('COMMIT');res.json({data:r.rows[0]})}catch(e){await client.query('ROLLBACK');next(e)}finally{client.release()}});
app.delete('/api/v1/customer/addresses/:id',auth,async(req,res,next)=>{try{const r=await pool.query('DELETE FROM addresses WHERE address_id=$1 AND user_id=$2',[req.params.id,req.user.user_id]);if(!r.rowCount)return fail(res,404,'ADDRESS_NOT_FOUND','Saved address not found.');res.json({data:{deleted:true}})}catch(e){next(e)}});
app.get('/api/v1/customer/orders',auth,async(req,res,next)=>{try{const r=await pool.query('SELECT order_id AS id,order_number AS "orderNumber",status,total,created_at AS "placedAt",items_snapshot AS items FROM orders WHERE user_id=$1 ORDER BY created_at DESC',[req.user.user_id]);res.json({data:r.rows})}catch(e){next(e)}});
app.post('/api/v1/customer/orders',auth,async(req,res,next)=>{const client=await pool.connect();try{const {addressId,idempotencyKey}=req.body||{};if(!addressId||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>100)return fail(res,400,'INVALID_ORDER','Address and idempotency key are required.');const old=await client.query('SELECT order_id AS id,order_number AS "orderNumber",status,total FROM orders WHERE idempotency_key=$1',[idempotencyKey]);if(old.rowCount)return res.json({data:old.rows[0],idempotent:true});await client.query('BEGIN');const address=await client.query('SELECT address_id,recipient_name,phone,line1,locality,city,state,pin,type FROM addresses WHERE address_id=$1 AND user_id=$2',[addressId,req.user.user_id]);if(!address.rowCount){await client.query('ROLLBACK');return fail(res,400,'INVALID_ADDRESS','Select a saved delivery address.')}const items=await getCart(req.user.user_id,client);if(!items.length){await client.query('ROLLBACK');return fail(res,400,'EMPTY_CART','Your cart is empty.')}if(items.some(x=>x.quantity>x.availableQuantity)){await client.query('ROLLBACK');return fail(res,409,'INSUFFICIENT_STOCK','Stock changed; review your cart.')}const subtotal=items.reduce((s,x)=>s+Number(x.price)*x.quantity,0),shipping=subtotal>=1499?0:99,total=subtotal+shipping,number='CLV-'+Date.now();const order=await client.query("INSERT INTO orders(order_number,user_id,status,subtotal,shipping,total,address_snapshot,items_snapshot,idempotency_key) VALUES($1,$2,'placed',$3,$4,$5,$6,$7,$8) RETURNING order_id AS id,order_number AS \"orderNumber\",status,total,created_at AS \"placedAt\"",[number,req.user.user_id,subtotal,shipping,total,address.rows[0],items,idempotencyKey]);for(const x of items){const stock=await client.query('UPDATE products SET available_quantity=available_quantity-$1 WHERE slug=$2 AND available_quantity >= $1',[x.quantity,x.slug]);if(!stock.rowCount)throw Object.assign(new Error('Stock changed; review your cart.'),{statusCode:409,apiCode:'INSUFFICIENT_STOCK'});}await client.query("UPDATE carts SET status='converted',updated_at=now() WHERE user_id=$1 AND status='active'",[req.user.user_id]);await client.query('COMMIT');res.status(201).json({data:order.rows[0]})}catch(e){try{await client.query('ROLLBACK')}catch{}if(e.code==='23505'){const old=await pool.query('SELECT order_id AS id,order_number AS "orderNumber",status,total FROM orders WHERE idempotency_key=$1',[req.body?.idempotencyKey]);if(old.rowCount)return res.json({data:old.rows[0],idempotent:true})}next(e)}finally{client.release()}});
app.use((req,res)=>fail(res,404,'NOT_FOUND','Endpoint not found.'));
app.use((e,_req,res,_next)=>{if(e.message==='Origin is not allowed by CORS')return fail(res,403,'ORIGIN_NOT_ALLOWED','This origin is not allowed.');if(e instanceof SyntaxError)return fail(res,400,'INVALID_JSON','Request body must be valid JSON.');console.error('Clivelle API error:',e);if(e.apiCode==='INSUFFICIENT_STOCK')return fail(res,409,'INSUFFICIENT_STOCK',e.message);return fail(res,500,'INTERNAL_ERROR','Something went wrong.')});
const port=Number(process.env.PORT||4000);
const server=await init().then(()=>app.listen(port,'0.0.0.0',()=>console.log('Clivelle PostgreSQL API listening on '+port)));
async function shutdown(){server.close(async()=>{await pool.end();process.exit(0)})}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
