const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin, requireCustomerOrAdmin } = require('../middleware/auth');

const router = express.Router();

// --- Customer Address Management ---
// إدارة عناوين العميل

// Get customer addresses
// جلب عناوين العميل
router.get('/addresses', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query('SELECT * FROM customer_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC', [userId]);
    res.json({ message: 'Addresses retrieved successfully', addresses: result.rows });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({ error: 'Server error', message: 'An error occurred while retrieving addresses' });
  }
});

// Add new address
// إضافة عنوان جديد
router.post('/addresses', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { address, phone, city, is_default = false } = req.body;
    const userId = req.user.id;

    if (!address || !phone || !city) {
      return res.status(400).json({ error: 'Validation error', message: 'Address, phone, and city are required' });
    }

    if (is_default) {
      await pool.query('UPDATE customer_addresses SET is_default = false WHERE user_id = $1', [userId]);
    }

    const result = await pool.query(
      'INSERT INTO customer_addresses (user_id, address, phone, city, is_default) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, address, phone, city, is_default]
    );
    res.status(201).json({ message: 'Address created successfully', address: result.rows[0] });
  } catch (error) {
    console.error('Create address error:', error);
    res.status(500).json({ error: 'Server error', message: 'An error occurred while creating the address' });
  }
});

// Update address (More flexible)
// تحديث العنوان (أكثر مرونة)
router.put('/addresses/:id', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { address, phone, city, is_default } = req.body;

    const existingAddress = await pool.query('SELECT * FROM customer_addresses WHERE id = $1 AND user_id = $2', [id, userId]);
    if (existingAddress.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found', message: 'Address not found or does not belong to you.' });
    }

    if (is_default === true) {
      await pool.query('UPDATE customer_addresses SET is_default = false WHERE user_id = $1 AND id != $2', [userId, id]);
    }

    const fields = { address, phone, city, is_default };
    const updateFields = Object.keys(fields)
      .filter(key => fields[key] !== undefined)
      .map((key, index) => `${key} = $${index + 1}`)
      .join(', ');

    if (updateFields.length === 0) {
        return res.status(400).json({ error: 'Bad Request', message: 'No fields to update provided.' });
    }

    const queryParams = Object.values(fields).filter(value => value !== undefined);
    queryParams.push(id, userId);

    const result = await pool.query(
      `UPDATE customer_addresses SET ${updateFields} WHERE id = $${queryParams.length - 1} AND user_id = $${queryParams.length} RETURNING *`,
      queryParams
    );
    res.json({ message: 'Address updated successfully', address: result.rows[0] });
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({ error: 'Server error', message: 'An error occurred while updating the address' });
  }
});

// Delete address
// حذف العنوان
router.delete('/addresses/:id', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const result = await pool.query('DELETE FROM customer_addresses WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found', message: 'Address not found or does not belong to you.' });
    }
    res.json({ message: 'Address deleted successfully', deletedAddress: result.rows[0] });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({ error: 'Server error', message: 'An error occurred while deleting the address' });
  }
});


// --- Order Management ---
// إدارة الطلبات

// Get user orders (customer gets their own, admin gets all) - EFFICIENT & SECURE VERSION
// جلب طلبات المستخدم (العميل يحصل على طلباته، والمدير يحصل على جميع الطلبات) - نسخة محسنة وآمنة
router.get('/', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    
    let baseQuery = `FROM orders o LEFT JOIN customer_addresses ca ON o.address_id = ca.id LEFT JOIN users u ON o.user_id = u.id WHERE 1=1`;
    let countParams = [];
    let queryParams = [];

    if (!isAdmin) {
      baseQuery += ` AND o.user_id = $${queryParams.length + 1}`;
      queryParams.push(userId);
    }
    if (status) {
      baseQuery += ` AND o.status = $${queryParams.length + 1}`;
      queryParams.push(status);
    }
    countParams = [...queryParams];

    const offset = (page - 1) * limit;
    const orderQuery = `SELECT o.*, ca.address, ca.phone, ca.city, u.username, u.email ${baseQuery} ORDER BY o.created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const orderResult = await pool.query(orderQuery, queryParams);
    const orders = orderResult.rows;
    
    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, countParams);
    const totalOrders = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalOrders / limit);

    if (orders.length === 0) {
        return res.json({ message: 'Orders retrieved successfully', orders: [], pagination: { currentPage: parseInt(page), totalPages, totalOrders } });
    }

    const orderIds = orders.map(order => order.id);
    const itemsResult = await pool.query(`
      SELECT oi.*, p.name as product_name, p.image_url, p.image_data
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ANY($1::int[])
    `, [orderIds]);

    const itemsByOrderId = itemsResult.rows.reduce((acc, item) => {
      if (!acc[item.order_id]) acc[item.order_id] = [];
      acc[item.order_id].push(item);
      return acc;
    }, {});

    const ordersWithItems = orders.map(order => ({
      ...order,
      items: itemsByOrderId[order.id] || []
    }));

    res.json({ message: 'Orders retrieved successfully', orders: ordersWithItems, pagination: { currentPage: parseInt(page), totalPages, totalOrders } });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Server error', message: 'An error occurred while retrieving orders' });
  }
});

// Create new order
// إنشاء طلب جديد
router.post('/', authenticateToken, requireCustomerOrAdmin, async (req, res) => {
  try {
    const { address_id, items } = req.body;
    const userId = req.user.id;

    if (!address_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Validation error', message: 'Address ID and a non-empty items array are required' });
    }

    const addressResult = await pool.query('SELECT * FROM customer_addresses WHERE id = $1 AND user_id = $2', [address_id, userId]);
    if (addressResult.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found', message: 'Address not found or does not belong to you.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let totalPrice = 0;
      const orderItemsData = [];

      for (const item of items) {
        const { product_id, quantity } = item;
        if (!product_id || !quantity || quantity <= 0) {
          throw new Error('Each item must have a valid product_id and a positive quantity.');
        }
        const productResult = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [product_id]);
        if (productResult.rows.length === 0) throw new Error(`Product with ID ${product_id} not found`);
        const product = productResult.rows[0];
        if (product.stock_quantity < quantity) throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock_quantity}, Requested: ${quantity}`);
        
        const price = product.price * (1 - (product.discount || 0) / 100);
        const subtotal = price * quantity;
        totalPrice += subtotal;
        orderItemsData.push({ product_id, quantity, price, subtotal, name: product.name });
        await client.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2', [quantity, product_id]);
      }

      const orderResult = await client.query(
        'INSERT INTO orders (user_id, address_id, total_price, status, payment_status) VALUES ($1, $2, $3, \'pending\', \'unpaid\') RETURNING *',
        [userId, address_id, totalPrice]
      );
      const newOrder = orderResult.rows[0];

      const itemQueries = orderItemsData.map(item => {
        return client.query(
          'INSERT INTO order_items (order_id, product_id, quantity, price, subtotal) VALUES ($1, $2, $3, $4, $5)',
          [newOrder.id, item.product_id, item.quantity, item.price, item.subtotal]
        );
      });
      await Promise.all(itemQueries);

      await client.query('COMMIT');
      res.status(201).json({ message: 'Order created successfully', order: { ...newOrder, items: orderItemsData } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Server error', message: error.message || 'An error occurred while creating the order' });
  }
});

// Get order by ID with items
// جلب طلب محدد بواسطة الـ ID مع المنتجات
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

    if (!isAdmin) {
      orderQuery += ' AND o.user_id = $2';
      orderParams.push(userId);
    }

    const orderResult = await pool.query(orderQuery, orderParams);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found', message: 'Order not found or you do not have access to it.' });
    }

    const itemsResult = await pool.query(`
      SELECT oi.*, p.name as product_name, p.image_url, p.image_data
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [id]);

    const order = { ...orderResult.rows[0], items: itemsResult.rows };
    res.json({ message: 'Order retrieved successfully', order });
  } catch (error) {
    console.error('Get order by ID error:', error);
    res.status(500).json({ error: 'Server error', message: 'An error occurred while retrieving the order' });
  }
});

// Update order status (admin only)
// تحديث حالة الطلب (للمدير فقط)
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payment_status } = req.body;
    const validOrderStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    const validPaymentStatuses = ['unpaid', 'paid', 'refunded'];

    if (status && !validOrderStatuses.includes(status)) {
        return res.status(400).json({ error: 'Validation Error', message: `Invalid order status. Must be one of: ${validOrderStatuses.join(', ')}` });
    }
    if (payment_status && !validPaymentStatuses.includes(payment_status)) {
        return res.status(400).json({ error: 'Validation Error', message: `Invalid payment status. Must be one of: ${validPaymentStatuses.join(', ')}` });
    }

    let updateFields = [];
    let queryParams = [];
    
    if (status) {
      updateFields.push(`status = $${queryParams.length + 1}`);
      queryParams.push(status);
    }
    if (payment_status) {
      updateFields.push(`payment_status = $${queryParams.length + 1}`);
      queryParams.push(payment_status);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Validation error', message: 'At least one status field (status, payment_status) must be provided.' });
    }

    queryParams.push(id);
    const query = `UPDATE orders SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = $${queryParams.length} RETURNING *`;
    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ message: 'Order status updated successfully', order: result.rows[0] });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Server error', message: 'An error occurred while updating the order status' });
  }
});

module.exports = router;
