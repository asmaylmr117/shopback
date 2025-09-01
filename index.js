const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { pool } = require('./config/database');
const { authenticateToken, requireAdmin } = require('./middleware/auth');

const app = express();

// Middleware الأساسي
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running!',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// API root endpoint
app.get('/api', (req, res) => {
  res.status(200).json({
    message: '🟢 API root is working fine',
    now: new Date().toISOString()
  });
});

// تعطيل الروتات المؤقت للاختبار
console.log('Testing without routes...');

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error occurred:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: 'Something went wrong'
  });
});

// Handle 404s
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist'
  });
});

module.exports = app;
