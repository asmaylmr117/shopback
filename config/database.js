const { Pool } = require('pg');

// Create a new pool instance with connection pooling optimized for serverless
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Serverless optimizations
  max: 1, // Reduce connection pool size for serverless
  min: 0, // Minimum connections
  idleTimeoutMillis: 1000, // Close idle connections quickly
  connectionTimeoutMillis: 5000, // Connection timeout
  query_timeout: 15000, // Increased for initialization queries
  statement_timeout: 15000, // Statement timeout
  // Add these for Vercel's serverless environment
  allowExitOnIdle: true,
  // Prevent hanging connections
  keepAlive: false,
  keepAliveInitialDelayMillis: 0,
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Database pool error:', err);
});

// Handle pool connection events (only in development to reduce logs)
if (process.env.NODE_ENV === 'development') {
  pool.on('connect', () => {
    console.log('Database connected');
  });

  pool.on('acquire', () => {
    console.log('Database connection acquired');
  });

  pool.on('release', () => {
    console.log('Database connection released');
  });
}

// Database initialization function with timeout protection
const initializeDatabase = async () => {
  let client;
  try {
    // Connect with timeout
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      )
    ]);
    
    console.log('Initializing database tables...');

    // Execute all table creation queries in correct order
    const queries = [
      // Create users table FIRST
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'customer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Create product_images table
      `CREATE TABLE IF NOT EXISTS product_images (
        id SERIAL PRIMARY KEY,
        image_data BYTEA NOT NULL,
        mime_type VARCHAR(50) NOT NULL,
        file_size INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Create products table
      `CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        discount DECIMAL(5,2) DEFAULT 0,
        stars DECIMAL(2,1) DEFAULT 0,
        category VARCHAR(100),
        style VARCHAR(100),
        style2 VARCHAR(100),
        type VARCHAR(100),
        type2 VARCHAR(100),
        image_id INTEGER REFERENCES product_images(id) ON DELETE SET NULL,
        stock_quantity INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Create reviews table
      `CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        review TEXT NOT NULL,
        rating DECIMAL(2,1) DEFAULT 5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Create customer_addresses table (depends on users)
      `CREATE TABLE IF NOT EXISTS customer_addresses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        phone VARCHAR(20) NOT NULL,
        city VARCHAR(100) NOT NULL,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Create orders table (depends on users and customer_addresses)
      `CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        address_id INTEGER REFERENCES customer_addresses(id),
        total_price DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_status VARCHAR(50) DEFAULT 'unpaid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Create order_items table (depends on orders and products)
      `CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        subtotal DECIMAL(10,2) NOT NULL
      )`
    ];

    // Execute each query with timeout
    for (const query of queries) {
      try {
        await Promise.race([
          client.query(query),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 10000)
          )
        ]);
        console.log(`✅ Table created: ${query.split(' ')[5]}`);
      } catch (error) {
        console.error(`❌ Error creating table: ${error.message}`);
        // Continue with other tables instead of failing completely
      }
    }

    // Create indexes with timeout
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_products_image_id ON products(image_id)`,
      `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`
    ];

    for (const indexQuery of indexes) {
      try {
        await Promise.race([
          client.query(indexQuery),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Index creation timeout')), 5000)
          )
        ]);
        console.log(`✅ Index created: ${indexQuery.split(' ')[5]}`);
      } catch (error) {
        console.log('Index creation note:', error.message);
      }
    }

    // Add image_id column to existing products table if it doesn't exist
    try {
      await Promise.race([
        client.query(`
          ALTER TABLE products ADD COLUMN IF NOT EXISTS image_id INTEGER REFERENCES product_images(id) ON DELETE SET NULL
        `),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Alter table timeout')), 5000)
        )
      ]);
      console.log('✅ Image_id column added to products table');
    } catch (error) {
      console.log('Column alteration note:', error.message);
    }

    console.log('✅ Database tables initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

// Test database connection with timeout
const testConnection = async () => {
  let client;
  try {
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 3000)
      )
    ]);
    
    await Promise.race([
      client.query('SELECT 1'),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 3000)
      )
    ]);
    
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
};

// Helper function to execute queries with timeout
const queryWithTimeout = async (text, params, timeoutMs = 10000) => {
  let client;
  try {
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 3000)
      )
    ]);
    
    return await Promise.race([
      client.query(text, params),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
      )
    ]);
  } finally {
    if (client) {
      client.release();
    }
  }
};

// Graceful shutdown for serverless
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  try {
    await pool.end();
    console.log('Database pool closed successfully');
  } catch (error) {
    console.error('Error closing database pool:', error);
  }
});

// Graceful shutdown helper
const closePool = async () => {
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch (error) {
    console.error('Error closing database pool:', error);
  }
};

module.exports = {
  pool,
  initializeDatabase,
  testConnection,
  queryWithTimeout,
  closePool
};
