const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin, requireCustomerOrAdmin } = require('../middleware/auth');

const router = express.Router();

// Customer Address Management - PUT SPECIFIC ROUTES FIRST

// Get order statistics (admin only) - SPECIFIC ROUTE FIRST
router.get('/stats/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const totalOrdersResult = await pool.query('SELECT COUNT(*) as total FROM orders');
    const totalRevenueResult = await pool.query('SELECT SUM(total_price) as revenue FROM orders WHERE payment_status = $1', ['paid']);
    const statusDistResult = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM orders 
      GROUP BY status 
      ORDER BY count DESC
    `);
    const paymentDistResult = await pool.query(`
      SELECT payment_status, COUNT(*) as count 
      FROM orders 
      GROUP BY payment_status 
      ORDER BY count DESC
    `);

    res.json({
      message: 'Order statistics retrieved successfully',
      stats: {
        totalOrders: parseInt(totalOrdersResult.rows[0].total),
        totalRevenue: parseFloat(totalRevenueResult.rows[0].revenue || 0),
        statusDistribution: statusDistResult.rows,
        paymentDistribution: paymentDistResult.rows
      }
    });
  } catch (error) {
    console.error('Get order stats error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving order statistics'
    });
  }
});

// Get customer addresses
router.get('/addresses', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT * FROM customer_addresses 
      WHERE user_id = $1 
      ORDER BY is_default DESC, created_at DESC
    `, [userId]);

    res.json({
      message: 'Addresses retrieved successfully',
      addresses: result.rows
    });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving addresses'
    });
  }
});

// Add new address
router.post('/addresses', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { address, phone, city, is_default = false } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!address || !phone || !city) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Address, phone, and city are required'
      });
    }

    // If this is set as default, unset other default addresses
    if (is_default) {
      await pool.query('UPDATE customer_addresses SET is_default = false WHERE user_id = $1', [userId]);
    }

    const result = await pool.query(`
      INSERT INTO customer_addresses (user_id, address, phone, city, is_default)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [userId, address, phone, city, is_default]);

    res.status(201).json({
      message: 'Address created successfully',
      address: result.rows[0]
    });
  } catch (error) {
    console.error('Create address error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while creating the address'
    });
  }
});

// Update address
router.put('/addresses/:id', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { address, phone, city, is_default } = req.body;
    const userId = req.user.id;

    // Check if address exists and belongs to user
    const existingAddress = await pool.query(
      'SELECT * FROM customer_addresses WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (existingAddress.rows.length === 0) {
      return res.status(404).json({
        error: 'Address not found',
        message: 'Address with the specified ID does not exist or does not belong to you'
      });
    }

    // If this is set as default, unset other default addresses
    if (is_default) {
      await pool.query('UPDATE customer_addresses SET is_default = false WHERE user_id = $1', [userId]);
    }

    // Build update query dynamically
    let updateFields = [];
    let queryParams = [];
    let paramCount = 1;

    const fields = { address, phone, city, is_default };

    // Map fields to valid column names to prevent SQL injection
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined) {
        updateFields.push(`${key} = $${paramCount}`);
        queryParams.push(value);
        paramCount++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'At least one field must be provided for update'
      });
    }

    // Add address ID and user ID for WHERE clause
    queryParams.push(id);
    queryParams.push(userId);

    const query = `
      UPDATE customer_addresses 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
      RETURNING *
    `;

    const result = await pool.query(query, queryParams);

    res.json({
      message: 'Address updated successfully',
      address: result.rows[0]
    });
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while updating the address'
    });
  }
});

// Delete address
router.delete('/addresses/:id', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if address exists and belongs to user
    const existingAddress = await pool.query(
      'SELECT * FROM customer_addresses WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (existingAddress.rows.length === 0) {
      return res.status(404).json({
        error: 'Address not found',
        message: 'Address with the specified ID does not exist or does not belong to you'
      });
    }

    await pool.query('DELETE FROM customer_addresses WHERE id = $1 AND user_id = $2', [id, userId]);

    res.json({
      message: 'Address deleted successfully',
      deletedAddress: existingAddress.rows[0]
    });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while deleting the address'
    });
  }
});

// Order Management

// Get user orders (customer gets their own, admin gets all) - OPTIMIZED VERSION
router.get('/', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';

    // Validate pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Page and limit must be positive integers'
      });
    }

    let query = `
      SELECT o.*, ca.address, ca.phone, ca.city, u.username, u.email
      FROM orders o
      LEFT JOIN customer_addresses ca ON o.address_id = ca.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE 1=1
    `;
    let queryParams = [];
    let paramCount = 0;

    // If not admin, only show user's own orders
    if (!isAdmin) {
      paramCount++;
      query += ` AND o.user_id = $${paramCount}`;
      queryParams.push(userId);
    }

    // Filter by status if provided
    if (status) {
      paramCount++;
      query += ` AND o.status = $${paramCount}`;
      queryParams.push(status);
    }

    // Add pagination
    const offset = (pageNum - 1) * limitNum;
    query += ` ORDER BY o.created_at DESC`;
    
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(limitNum);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    const result = await pool.query(query, queryParams);

    // Get items for all orders in a single optimized query
    const orderIds = result.rows.map(order => order.id);
    
    let itemsResult = { rows: [] };
    if (orderIds.length > 0) {
      const itemsQuery = `
        SELECT oi.*, p.name as product_name, p.image_url,
               ENCODE(p.image_data, 'base64') as image_data
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ANY($1::int[])
        ORDER BY oi.order_id, oi.id
      `;
      
      itemsResult = await pool.query(itemsQuery, [orderIds]);
    }

    // Group items by order_id for efficient lookup
    const itemsByOrderId = {};
    itemsResult.rows.forEach(item => {
      if (!itemsByOrderId[item.order_id]) {
        itemsByOrderId[item.order_id] = [];
      }
      itemsByOrderId[item.order_id].push(item);
    });

    // Add items to each order
    const ordersWithItems = result.rows.map(order => ({
      ...order,
      items: itemsByOrderId[order.id] || []
    }));

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM orders WHERE 1=1';
    let countParams = [];
    let countParamCount = 0;

    if (!isAdmin) {
      countParamCount++;
      countQuery += ` AND user_id = $${countParamCount}`;
      countParams.push(userId);
    }

    if (status) {
      countParamCount++;
      countQuery += ` AND status = $${countParamCount}`;
      countParams.push(status);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalOrders = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalOrders / limitNum);

    console.log('Orders with items response:', JSON.stringify(ordersWithItems, null, 2));

    res.json({
      message: 'Orders retrieved successfully',
      orders: ordersWithItems,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalOrders,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving orders'
    });
  }
});

// Create new order
router.post('/', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { address_id, items } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!address_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Address ID and items array are required'
      });
    }

    // Verify address belongs to user
    const addressResult = await pool.query(
      'SELECT * FROM customer_addresses WHERE id = $1 AND user_id = $2',
      [address_id, userId]
    );

    if (addressResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Address not found',
        message: 'Address with the specified ID does not exist or does not belong to you'
      });
    }

    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      let totalPrice = 0;
      const orderItems = [];

      // Validate items and calculate total
      for (const item of items) {
        const { product_id, quantity } = item;

        if (!product_id || !quantity || quantity <= 0) {
          throw new Error('Each item must have a valid product_id and positive quantity');
        }

        // Get product details
        const productResult = await client.query('SELECT * FROM products WHERE id = $1', [product_id]);
        
        if (productResult.rows.length === 0) {
          throw new Error(`Product with ID ${product_id} not found`);
        }

        const product = productResult.rows[0];
        
        // Check stock
        if (product.stock_quantity < quantity) {
          throw new Error(`Insufficient stock for product ${product.name}. Available: ${product.stock_quantity}, Requested: ${quantity}`);
        }

        const price = product.price * (1 - product.discount / 100);
        const subtotal = price * quantity;
        totalPrice += subtotal;

        orderItems.push({
          product_id,
          quantity,
          price,
          subtotal
        });

        // Update stock
        await client.query(
          'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
          [quantity, product_id]
        );
      }

      // Create order
      const orderResult = await client.query(`
        INSERT INTO orders (user_id, address_id, total_price, status, payment_status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [userId, address_id, totalPrice, 'pending', 'unpaid']);

      const order = orderResult.rows[0];

      // Create order items
      for (const item of orderItems) {
        await client.query(`
          INSERT INTO order_items (order_id, product_id, quantity, price, subtotal)
          VALUES ($1, $2, $3, $4, $5)
        `, [order.id, item.product_id, item.quantity, item.price, item.subtotal]);
      }

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Order created successfully',
        order: {
          ...order,
          items: orderItems
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message || 'An error occurred while creating the order'
    });
  }
});

// Get order by ID with items - MUST come after specific routes
router.get('/:id', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';

    let orderQuery = `
      SELECT o.*, ca.address, ca.phone, ca.city, u.username, u.email
      FROM orders o
      LEFT JOIN customer_addresses ca ON o.address_id = ca.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `;
    let orderParams = [id];

    // If not admin, only allow access to own orders
    if (!isAdmin) {
      orderQuery += ' AND o.user_id = $2';
      orderParams.push(userId);
    }

    const orderResult = await pool.query(orderQuery, orderParams);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Order not found',
        message: 'Order with the specified ID does not exist or you do not have access to it'
      });
    }

    // Get order items with enhanced product information including image data
    const itemsResult = await pool.query(`
      SELECT oi.*, p.name as product_name, p.image_url,
             ENCODE(p.image_data, 'base64') as image_data
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY oi.id
    `, [id]);

    const order = orderResult.rows[0];
    order.items = itemsResult.rows;

    console.log('Single order with items:', JSON.stringify(order, null, 2));

    res.json({
      message: 'Order retrieved successfully',
      order
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving the order'
    });
  }
});

// Update order status (admin only)
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payment_status } = req.body;

    // Validate status values
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    const validPaymentStatuses = ['unpaid', 'paid', 'refunded'];

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Validation error',
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    if (payment_status && !validPaymentStatuses.includes(payment_status)) {
      return res.status(400).json({
        error: 'Validation error',
        message: `Payment status must be one of: ${validPaymentStatuses.join(', ')}`
      });
    }

    // Check if order exists
    const existingOrder = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    
    if (existingOrder.rows.length === 0) {
      return res.status(404).json({
        error: 'Order not found',
        message: 'Order with the specified ID does not exist'
      });
    }

    // Build update query
    let updateFields = [];
    let queryParams = [];
    let paramCount = 0;

    if (status !== undefined) {
      paramCount++;
      updateFields.push(`status = $${paramCount}`);
      queryParams.push(status);
    }

    if (payment_status !== undefined) {
      paramCount++;
      updateFields.push(`payment_status = $${paramCount}`);
      queryParams.push(payment_status);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'At least one status field must be provided for update'
      });
    }

    // Add updated_at and order ID
    paramCount++;
    updateFields.push(`updated_at = $${paramCount}`);
    queryParams.push(new Date());

    paramCount++;
    queryParams.push(id);

    const query = `
      UPDATE orders 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, queryParams);

    res.json({
      message: 'Order status updated successfully',
      order: result.rows[0]
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while updating the order status'
    });
  }
});

module.exports = router;
