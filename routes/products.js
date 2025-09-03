const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const busboy = require('busboy');

const router = express.Router();

// IMPORTANT: Put specific routes BEFORE parameterized routes

// Get product categories (public route)
router.get('/meta/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category');
    
    res.json({
      message: 'Categories retrieved successfully',
      categories: result.rows.map(row => row.category)
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving categories'
    });
  }
});

// Get product types (public route)
router.get('/meta/types', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT type FROM products WHERE type IS NOT NULL
      UNION
      SELECT DISTINCT type2 FROM products WHERE type2 IS NOT NULL AND type2 != 'All'
      ORDER BY type
    `);
    
    res.json({
      message: 'Types retrieved successfully',
      types: result.rows.map(row => row.type)
    });
  } catch (error) {
    console.error('Get types error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving types'
    });
  }
});

// Get product styles (public route)
router.get('/meta/styles', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT style FROM products WHERE style IS NOT NULL
      UNION
      SELECT DISTINCT style2 FROM products WHERE style2 IS NOT NULL AND style2 != ''
      ORDER BY style
    `);
    
    res.json({
      message: 'Styles retrieved successfully',
      styles: result.rows.map(row => row.style)
    });
  } catch (error) {
    console.error('Get styles error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving styles'
    });
  }
});

// Get products by category (public route)
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { limit = 10 } = req.query;

    const result = await pool.query(`
      SELECT p.*, pi.image_data 
      FROM products p 
      LEFT JOIN product_images pi ON p.image_id = pi.id 
      WHERE p.category = $1 
      ORDER BY p.created_at DESC 
      LIMIT $2
    `, [category, limit]);

    // Convert image data to base64 if exists
    const products = result.rows.map(product => ({
      ...product,
      image_data: product.image_data ? product.image_data.toString('base64') : null
    }));

    res.json({
      message: `${category} products retrieved successfully`,
      products,
      category
    });
  } catch (error) {
    console.error('Get products by category error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving products by category'
    });
  }
});

// Get all products (public route)
router.get('/', async (req, res) => {
  try {
    const { category, type, style, search, page = 1, limit = 20 } = req.query;
    
    let query = `
      SELECT p.*, pi.image_data 
      FROM products p 
      LEFT JOIN product_images pi ON p.image_id = pi.id 
      WHERE 1=1
    `;
    let queryParams = [];
    let paramCount = 0;

    // Add filters
    if (category) {
      paramCount++;
      query += ` AND p.category = $${paramCount}`;
      queryParams.push(category);
    }

    if (type) {
      paramCount++;
      query += ` AND (p.type = $${paramCount} OR p.type2 = $${paramCount})`;
      queryParams.push(type);
    }

    if (style) {
      paramCount++;
      query += ` AND (p.style = $${paramCount} OR p.style2 = $${paramCount})`;
      queryParams.push(style);
    }

    if (search) {
      paramCount++;
      query += ` AND p.name ILIKE $${paramCount}`;
      queryParams.push(`%${search}%`);
    }

    // Add pagination
    const offset = (page - 1) * limit;
    paramCount++;
    query += ` ORDER BY p.created_at DESC LIMIT $${paramCount}`;
    queryParams.push(limit);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    const result = await pool.query(query, queryParams);

    // Convert image data to base64 if exists
    const products = result.rows.map(product => ({
      ...product,
      image_data: product.image_data ? product.image_data.toString('base64') : null
    }));

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM products p WHERE 1=1';
    let countParams = [];
    let countParamCount = 0;

    if (category) {
      countParamCount++;
      countQuery += ` AND p.category = $${countParamCount}`;
      countParams.push(category);
    }

    if (type) {
      countParamCount++;
      countQuery += ` AND (p.type = $${countParamCount} OR p.type2 = $${countParamCount})`;
      countParams.push(type);
    }

    if (style) {
      countParamCount++;
      countQuery += ` AND (p.style = $${countParamCount} OR p.style2 = $${countParamCount})`;
      countParams.push(style);
    }

    if (search) {
      countParamCount++;
      countQuery += ` AND p.name ILIKE $${countParamCount}`;
      countParams.push(`%${search}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalProducts = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalProducts / limit);

    res.json({
      message: 'Products retrieved successfully',
      products,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalProducts,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving products'
    });
  }
});

// Add new product (admin only) - using busboy for FormData
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const bb = busboy({ headers: req.headers });
  let imageBuffer = null;
  let mimeType = '';
  let fileSize = 0;
  let productData = {};

  bb.on('field', (name, value) => {
    productData[name] = value;
  });

  bb.on('file', (name, file, info) => {
    const { filename, mimeType: fileMimeType } = info;
    mimeType = fileMimeType;
    
    const chunks = [];
    file.on('data', (chunk) => {
      chunks.push(chunk);
      fileSize += chunk.length;
    });
    
    file.on('end', () => {
      imageBuffer = Buffer.concat(chunks);
    });
  });

  bb.on('close', async () => {
    try {
      let image_id = null;
      
      // Process image if uploaded
      if (imageBuffer) {
        const imageResult = await pool.query(
          'INSERT INTO product_images (image_data, mime_type, file_size) VALUES ($1, $2, $3) RETURNING id',
          [imageBuffer, mimeType, fileSize]
        );
        image_id = imageResult.rows[0].id;
      }

      // Extract product data from form fields
      const {
        name,
        description,
        price,
        discount = 0,
        stars = 0,
        category,
        style,
        style2,
        type,
        type2,
        stock_quantity = 0
      } = productData;

      // Validate required fields
      if (!name || !price || !category || !type) {
        // Delete image if validation fails
        if (image_id) {
          await pool.query('DELETE FROM product_images WHERE id = $1', [image_id]);
        }
        
        return res.status(400).json({
          error: 'Validation error',
          message: 'Name, price, category, and type are required'
        });
      }

      const result = await pool.query(`
        INSERT INTO products (name, description, price, discount, stars, category, style, style2, type, type2, image_id, stock_quantity)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [
        name, 
        description, 
        parseFloat(price), 
        parseInt(discount || 0), 
        parseInt(stars || 0), 
        category, 
        style || '', 
        style2 || '', 
        type, 
        type2 || '', 
        image_id, 
        parseInt(stock_quantity || 0)
      ]);

      res.status(201).json({
        message: 'Product created successfully',
        product: result.rows[0]
      });

    } catch (error) {
      console.error('Create product error:', error);
      res.status(500).json({
        error: 'Server error',
        message: 'An error occurred while creating the product'
      });
    }
  });

  bb.on('error', (error) => {
    console.error('Busboy error:', error);
    res.status(500).json({
      error: 'Parse error',
      message: 'Failed to parse form data'
    });
  });

  req.pipe(bb);
});

// Get product by ID (public route) - MUST come after specific routes
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT p.*, pi.image_data 
      FROM products p 
      LEFT JOIN product_images pi ON p.image_id = pi.id 
      WHERE p.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Product not found',
        message: 'Product with the specified ID does not exist'
      });
    }

    const product = {
      ...result.rows[0],
      image_data: result.rows[0].image_data ? result.rows[0].image_data.toString('base64') : null
    };

    res.json({
      message: 'Product retrieved successfully',
      product
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving the product'
    });
  }
});

// Update product (admin only) - using busboy for FormData
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const bb = busboy({ headers: req.headers });
  let imageBuffer = null;
  let mimeType = '';
  let fileSize = 0;
  let productData = {};

  bb.on('field', (name, value) => {
    productData[name] = value;
  });

  bb.on('file', (name, file, info) => {
    const { filename, mimeType: fileMimeType } = info;
    mimeType = fileMimeType;
    
    const chunks = [];
    file.on('data', (chunk) => {
      chunks.push(chunk);
      fileSize += chunk.length;
    });
    
    file.on('end', () => {
      imageBuffer = Buffer.concat(chunks);
    });
  });

  bb.on('close', async () => {
    try {
      // Check if product exists first
      const existingProduct = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
      
      if (existingProduct.rows.length === 0) {
        return res.status(404).json({
          error: 'Product not found',
          message: 'Product with the specified ID does not exist'
        });
      }

      let image_id = existingProduct.rows[0].image_id;
      let oldImageId = null;
      
      // Process new image if uploaded
      if (imageBuffer) {
        const imageResult = await pool.query(
          'INSERT INTO product_images (image_data, mime_type, file_size) VALUES ($1, $2, $3) RETURNING id',
          [imageBuffer, mimeType, fileSize]
        );
        oldImageId = image_id; // Save old image ID for deletion
        image_id = imageResult.rows[0].id;
      }

      // Extract product data from form fields
      const {
        name,
        description,
        price,
        discount,
        stars,
        category,
        style,
        style2,
        type,
        type2,
        stock_quantity
      } = productData;

      // Build update query dynamically
      let updateFields = [];
      let queryParams = [];
      let paramCount = 0;

      const fields = {
        name, description, price, discount, stars, category, 
        style, style2, type, type2, stock_quantity
      };

      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          paramCount++;
          updateFields.push(`${key} = $${paramCount}`);
          
          // Convert numeric fields
          if (['price', 'discount', 'stars', 'stock_quantity'].includes(key)) {
            queryParams.push(parseFloat(value) || 0);
          } else {
            queryParams.push(value);
          }
        }
      });

      // Add image_id if there's a new image
      if (imageBuffer) {
        paramCount++;
        updateFields.push(`image_id = $${paramCount}`);
        queryParams.push(image_id);
      }

      if (updateFields.length === 0 && !imageBuffer) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'At least one field must be provided for update'
        });
      }

      // Add updated_at field
      paramCount++;
      updateFields.push(`updated_at = $${paramCount}`);
      queryParams.push(new Date());

      // Add product ID for WHERE clause
      paramCount++;
      queryParams.push(id);

      const query = `
        UPDATE products 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `;

      const result = await pool.query(query, queryParams);

      // Delete old image if it was replaced
      if (oldImageId) {
        await pool.query('DELETE FROM product_images WHERE id = $1', [oldImageId]);
      }

      res.json({
        message: 'Product updated successfully',
        product: result.rows[0]
      });

    } catch (error) {
      console.error('Update product error:', error);
      res.status(500).json({
        error: 'Server error',
        message: 'An error occurred while updating the product'
      });
    }
  });

  bb.on('error', (error) => {
    console.error('Busboy error:', error);
    res.status(500).json({
      error: 'Parse error',
      message: 'Failed to parse form data'
    });
  });

  req.pipe(bb);
});

// Delete product (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if product exists and get image_id
    const existingProduct = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    
    if (existingProduct.rows.length === 0) {
      return res.status(404).json({
        error: 'Product not found',
        message: 'Product with the specified ID does not exist'
      });
    }

    const product = existingProduct.rows[0];

    // Delete the product first
    await pool.query('DELETE FROM products WHERE id = $1', [id]);

    // Delete associated image if exists
    if (product.image_id) {
      await pool.query('DELETE FROM product_images WHERE id = $1', [product.image_id]);
    }

    res.json({
      message: 'Product deleted successfully',
      deletedProduct: product
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while deleting the product'
    });
  }
});

module.exports = router;
