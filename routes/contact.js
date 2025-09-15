const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Contact form endpoint (public)
router.post('/', async (req, res) => {
  console.log('📧 Received contact form submission');
  
  try {
    const pool = require('../config/database').pool;
    if (!pool) {
      console.error('❌ Database pool not available');
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Database connection not available'
      });
    }

    const { name, email, phone, subject, message, orderNumber } = req.body;
    
    if (!name || !email || !subject || !message) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        error: 'Validation error',
        message: 'Name, email, subject, and message are required',
        fields: {
          name: !name ? 'Name is required' : null,
          email: !email ? 'Email is required' : null,
          subject: !subject ? 'Subject is required' : null,
          message: !message ? 'Message is required' : null
        }
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('❌ Invalid email format');
      return res.status(400).json({
        error: 'Validation error',
        message: 'Please enter a valid email address',
        field: 'email'
      });
    }

    if (message.length < 10) {
      console.log('❌ Message too short');
      return res.status(400).json({
        error: 'Validation error',
        message: 'Message must be at least 10 characters long',
        field: 'message'
      });
    }

    if (message.length > 500) {
      console.log('❌ Message too long');
      return res.status(400).json({
        error: 'Validation error',
        message: 'Message cannot exceed 500 characters',
        field: 'message'
      });
    }

    if (phone && !/^\+?[\d\s\-\(\)]+$/.test(phone)) {
      console.log('❌ Invalid phone format');
      return res.status(400).json({
        error: 'Validation error',
        message: 'Please enter a valid phone number',
        field: 'phone'
      });
    }

    console.log('📧 Contact form data:', {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      subject,
      messageLength: message.length,
      hasPhone: !!phone,
      hasOrderNumber: !!orderNumber
    });

    await pool.query('SELECT 1');

    const result = await pool.query(
      `INSERT INTO contact_messages 
       (name, email, phone, subject, message, order_number) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, created_at`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone ? phone.trim() : null,
        subject.trim(),
        message.trim(),
        orderNumber ? orderNumber.trim() : null
      ]
    );

    const { id, created_at } = result.rows[0];
    console.log(`✅ Contact message saved with ID: ${id}`);

    res.status(201).json({
      success: true,
      message: 'Your message has been sent successfully! We\'ll get back to you within 24 hours.',
      data: {
        id: id,
        submittedAt: created_at,
        responseTime: '24 hours'
      }
    });

  } catch (error) {
    console.error('❌ Contact form submission error:', error);
    
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Duplicate submission',
        message: 'A similar message was recently submitted. Please wait before submitting again.'
      });
    }

    if (error.code === '42P01') {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Contact service is temporarily unavailable. Please try again later.'
      });
    }

    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while processing your message. Please try again later.',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
});

// Get contact messages endpoint (admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = require('../config/database').pool;
    if (!pool) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Database connection not available'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status || null;

    let query = `
      SELECT id, name, email, phone, subject, message, order_number, status, created_at
      FROM contact_messages
    `;
    let countQuery = `SELECT COUNT(*) FROM contact_messages`;
    let params = [];

    if (status) {
      query += ` WHERE status = $1`;
      countQuery += ` WHERE status = $1`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [messages, total] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, status ? [status] : [])
    ]);

    res.json({
      success: true,
      data: {
        messages: messages.rows,
        pagination: {
          page,
          limit,
          total: parseInt(total.rows[0].count),
          pages: Math.ceil(total.rows[0].count / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching contact messages:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while fetching messages'
    });
  }
});

// Update contact message status (admin only)
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = require('../config/database').pool;
    if (!pool) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Database connection not available'
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['new', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'Status must be one of: ' + validStatuses.join(', ')
      });
    }

    const result = await pool.query(
      `UPDATE contact_messages 
       SET status = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, status, updated_at`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Message not found',
        message: 'Contact message with the specified ID does not exist'
      });
    }

    res.json({
      success: true,
      message: 'Message status updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating contact message status:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while updating the message status'
    });
  }
});

module.exports = router;
