const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

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

// Add new product (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) =>
