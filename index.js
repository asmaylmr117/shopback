const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();

let pool, authenticateToken, requireAdmin, requireCustomerOrAdmin;
let databaseInitialized = false;

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://shopbackco.vercel.app',
  'https://yourfrontenddomain.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4.5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

app.post('/api/upload/image', upload.single('image'), async (req, res) => {
  if (!authenticateToken || !requireAdmin || !pool) {
    return res.status(503).json({
      error: 'Service unavailable',
      message: 'Required dependencies not loaded properly'
    });
  }

  try {
    authenticateToken(req, res, (authErr) => {
      if (authErr) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid or missing token'
        });
      }

      requireAdmin(req, res, async (adminErr) => {
        if (adminErr) {
          return res.status(403).json({
            error: 'Access denied',
            message: 'Admin privileges required'
          });
        }

        if (!req.file) {
          return res.status(400).json({
            error: 'Validation error',
            message: 'No image file uploaded'
          });
        }

        try {
          const imageBuffer = req.file.buffer;

          await pool.query('SELECT 1');

          const result = await pool.query(
            'INSERT INTO product_images (image_data, mime_type, file_size) VALUES ($1, $2, $3) RETURNING id',
            [imageBuffer, req.file.mimetype, req.file.size]
          );

          res.status(201).json({
            message: 'Image uploaded successfully',
            imageId: result.rows[0].id
          });
        } catch (dbError) {
          console.error('Database error:', dbError);
          res.status(500).json({
            error: 'Database error',
            message: 'Could not save image to database'
          });
        }
      });
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while uploading the image'
    });
  }
});

app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next();
  } else if (contentType.includes('application/json')) {
    return bodyParser.json({ limit: '10mb' })(req, res, next);
  } else {
    next();
  }
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/api', (req, res) => {
  res.status(200).json({
    message: 'API root is working fine',
    now: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    databaseInitialized
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running on Vercel!',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    status: 'healthy',
    services: {
      database: !!pool,
      databaseInitialized,
      authentication: !!authenticateToken && !!requireAdmin,
    },
    endpoints: {
      auth: '/api/auth',
      products: '/api/products',
      reviews: '/api/reviews',
      orders: '/api/orders',
      upload: '/api/upload/image',
      image: '/api/image/:id',
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/image/:id', async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      error: 'Service unavailable',
      message: 'Database connection not available'
    });
  }

  try {
    const { id } = req.params;
    await pool.query('SELECT 1');

    const result = await pool.query(
      'SELECT image_data, mime_type FROM product_images WHERE id = $1', 
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Image not found',
        message: 'Image with the specified ID does not exist'
      });
    }

    const { image_data, mime_type } = result.rows[0];
    res.set('Content-Type', mime_type);
    res.set('Cache-Control', 'public, max-age=31536000');
    res.set('Content-Length', image_data.length);
    res.send(image_data);
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving the image'
    });
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Unhandled error occurred:', error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'Image size must be less than 4.5MB'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Invalid file',
        message: 'Only one image file is allowed'
      });
    }
  }
  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'Only image files are allowed'
    });
  }
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist',
    requestedPath: req.originalUrl,
    method: req.method,
    databaseInitialized
  });
});

async function initializeApp() {
  try {
    const database = require('./config/database');
    pool = database.pool;
    if (database.initializeDatabase) {
      try {
        await database.initializeDatabase();
        databaseInitialized = true;
      } catch (err) {
        databaseInitialized = false;
      }
    }
  } catch (dbError) {
    console.error('❌ Failed to load database config:', dbError.message);
  }

  try {
    const auth = require('./middleware/auth');
    authenticateToken = auth.authenticateToken;
    requireAdmin = auth.requireAdmin;
    requireCustomerOrAdmin = auth.requireCustomerOrAdmin;
  } catch (authError) {
    console.error('❌ Failed to load auth middleware:', authError.message);
  }
}

initializeApp().then(() => {
  console.log('🚀 Application initialization completed');
});

module.exports = app;
