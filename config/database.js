const { Pool } = require('pg');
require('dotenv').config();

// Create a new pool instance
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Database connection error:', err);
});

// Database initialization function
const initializeDatabase = async () => {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'customer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create product_images table (new table for storing images)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id SERIAL PRIMARY KEY,
        image_data BYTEA NOT NULL,
        mime_type VARCHAR(50) NOT NULL,
        file_size INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create products table (updated to reference image table)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
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
      )
    `);

    // Create index on image_id for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_image_id ON products(image_id)
    `);

    // Create index on category for better filtering performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)
    `);

    // Create index on type columns for better filtering performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_type ON products(type)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_type2 ON products(type2)
    `);

    // Create index on style columns for better filtering performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_style ON products(style)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_style2 ON products(style2)
    `);

    // Create reviews table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        review TEXT NOT NULL,
        rating DECIMAL(2,1) DEFAULT 5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create customer_addresses table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_addresses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        phone VARCHAR(20) NOT NULL,
        city VARCHAR(100) NOT NULL,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        address_id INTEGER REFERENCES customer_addresses(id),
        total_price DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_status VARCHAR(50) DEFAULT 'unpaid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create order_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        subtotal DECIMAL(10,2) NOT NULL
      )
    `);

    // Migration: Add image_id column to existing products table if it doesn't exist
    try {
      await pool.query(`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS image_id INTEGER REFERENCES product_images(id) ON DELETE SET NULL
      `);
    } catch (error) {
      // Column might already exist, ignore error
      console.log('image_id column already exists or migration error:', error.message);
    }

    // Migration: Remove image_url column if it exists (optional cleanup)
    try {
      const checkColumn = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='products' AND column_name='image_url'
      `);
      
      if (checkColumn.rows.length > 0) {
        console.log('Found image_url column. You may want to migrate data before removing it.');
        // Uncomment the next line to remove the column after migration
        // await pool.query('ALTER TABLE products DROP COLUMN IF EXISTS image_url');
      }
    } catch (error) {
      console.log('Column check error:', error.message);
    }

    console.log('Database tables initialized successfully');
    console.log('Image storage system is ready');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

// Helper function to migrate existing image URLs to database storage (optional)
const migrateImageUrls = async () => {
  try {
    console.log('Starting image URL migration...');
    
    const products = await pool.query('SELECT id, image_url FROM products WHERE image_url IS NOT NULL AND image_id IS NULL');
    
    for (const product of products.rows) {
      try {
        // This is a placeholder - you would need to implement actual URL fetching
        // and conversion to binary data based on your specific needs
        console.log(`Would migrate image for product ${product.id}: ${product.image_url}`);
        
        // Example implementation (you would need to adapt this):
        /*
        const response = await fetch(product.image_url);
        const imageBuffer = await response.buffer();
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        
        const imageResult = await pool.query(
          'INSERT INTO product_images (image_data, mime_type, file_size) VALUES ($1, $2, $3) RETURNING id',
          [imageBuffer, mimeType, imageBuffer.length]
        );
        
        await pool.query(
          'UPDATE products SET image_id = $1 WHERE id = $2',
          [imageResult.rows[0].id, product.id]
        );
        */
      } catch (error) {
        console.error(`Failed to migrate image for product ${product.id}:`, error);
      }
    }
    
    console.log('Image URL migration completed');
  } catch (error) {
    console.error('Error during image migration:', error);
  }
};

module.exports = {
  pool,
  initializeDatabase,
  migrateImageUrls
};
