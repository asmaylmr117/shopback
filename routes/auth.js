const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Generate JWT token
const generateToken = (userId, role) => {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET || 'fallback_secret_key',
    { expiresIn: '24h' }
  );
};

// Admin login
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Username and password are required'
      });
    }

    // Check environment variables
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
      console.error('Admin credentials not set in environment variables');
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Admin credentials not configured properly'
      });
    }

    // Check if credentials match environment variables (for admin)
    if (username === adminUsername && password === adminPassword) {
      try {
        // Check if admin user exists in database
        let adminResult = await pool.query('SELECT * FROM users WHERE username = $1 AND role = $2', [username, 'admin']);
        
        let adminUser;
        if (adminResult.rows.length === 0) {
          // Create admin user if doesn't exist
          const hashedPassword = await bcrypt.hash(password, 10);
          const newAdminResult = await pool.query(`
            INSERT INTO users (username, email, password, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id, username, email, role
          `, [username, 'admin@shop.co', hashedPassword, 'admin']);
          adminUser = newAdminResult.rows[0];
        } else {
          adminUser = adminResult.rows[0];
        }

        const token = generateToken(adminUser.id, adminUser.role);

        res.json({
          message: 'Admin login successful',
          token,
          user: {
            id: adminUser.id,
            username: adminUser.username,
            email: adminUser.email,
            role: adminUser.role
          }
        });
      } catch (dbError) {
        console.error('Database error during admin login:', dbError);
        return res.status(500).json({
          error: 'Database error',
          message: 'Could not process admin login due to database issues'
        });
      }
    } else {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid admin credentials'
      });
    }
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred during admin login'
    });
  }
});

// Customer registration
router.post('/customer/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Username, email, and password are required'
      });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'User already exists',
        message: 'Username or email already registered'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new customer
    const newUser = await pool.query(`
      INSERT INTO users (username, email, password, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, email, role
    `, [username, email, hashedPassword, 'customer']);

    const user = newUser.rows[0];
    const token = generateToken(user.id, user.role);

    res.status(201).json({
      message: 'Customer registration successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Customer registration error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred during registration'
    });
  }
});

// Customer login
router.post('/customer/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Username and password are required'
      });
    }

    // Find user by username or email
    const userResult = await pool.query(
      'SELECT * FROM users WHERE (username = $1 OR email = $1) AND role = $2',
      [username, 'customer']
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid credentials'
      });
    }

    const user = userResult.rows[0];

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid credentials'
      });
    }

    const token = generateToken(user.id, user.role);

    res.json({
      message: 'Customer login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Customer login error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred during login'
    });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    res.json({
      message: 'Profile retrieved successfully',
      user: req.user
    });
  } catch (error) {
    console.error('Profile retrieval error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving profile'
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user.id;

    if (!email) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Email is required'
      });
    }

    // Check if email is already taken by another user
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND id != $2',
      [email, userId]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Email already exists',
        message: 'This email is already registered to another account'
      });
    }

    // Update user
    const updatedUser = await pool.query(`
      UPDATE users 
      SET email = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, username, email, role
    `, [email, userId]);

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser.rows[0]
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while updating profile'
    });
  }
});

// Logout (client-side token removal)
router.post('/logout', authenticateToken, (req, res) => {
  res.json({
    message: 'Logout successful. Please remove the token from client storage.'
  });
});

module.exports = router;
