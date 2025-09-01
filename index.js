const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { pool } = require('./config/database');
const { authenticateToken, requireAdmin } = require('./middleware/auth');

const app = express();

// Configure multer for serverless environment with stricter limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024, // Reduced to 4MB for safety
    files: 1,
    fields: 10,
    fieldSize: 1024 * 1024, // 1MB per field
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Middleware with consistent size limits
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourfrontenddomain.com', 'https://yourfrontenddomain.vercel.app']
    : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Reduce body parser limits to match serverless constraints
app.use(express.json({ 
  limit: '4mb',
  verify: (req, res, buf) => {
    // Verify content-length matches actual body size
    const contentLength = parseInt(req.get('Content-Length') || '0');
    if (contentLength > 0 && buf.length !== contentLength) {
      throw new Error('Request size mismatch');
    }
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '4mb',
  verify: (req, res, buf) => {
    const contentLength = parseInt(req.get('Content-Length') || '0');
    if (contentLength > 0 && buf.length !== contentLength) {
      throw new Error('Request size mismatch');
    }
  }
}));

// Add request logging middleware for debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - Content-Length: ${req.get('Content-Length') || 'none'}`);
  next();
});

// Image upload endpoint with enhanced error handling
app.post('/upload/image', authenticateToken, requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File too large',
            message: 'Image size must be less than 4MB for serverless deployment'
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            error: 'Invalid file',
            message: 'Only one image file is allowed'
          });
        }
      }
      return res.status(400).json({
        error: 'Upload error',
        message: err.message
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'No image file uploaded'
      });
    }

    const imageBuffer = req.file.buffer;
    
    // Validate buffer size
    if (imageBuffer.length > 4 * 1024 * 1024) {
      return res.status(400).json({
        error: 'File too large',
        message: 'Image size exceeds 4MB limit'
      });
    }
    
    // Initialize database connection if not already done
    try {
      await pool.query('SELECT 1');
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      return res.status(500).json({
        error: 'Database error',
        message: 'Could not connect to database'
      });
    }

    const result = await pool.query(
      'INSERT INTO product_images (image_data, mime_type, file_size) VALUES ($1, $2, $3) RETURNING id',
      [imageBuffer, req.file.mimetype, req.file.size]
    );

    res.status(201).json({
      message: 'Image uploaded successfully',
      imageId: result.rows[0].id
    });
  } catch (error) {
    console.error('Image upload error:', error);
    
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while uploading the image'
    });
  }
});

// Serve images with better error handling
app.get('/image/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID parameter
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        error: 'Invalid ID',
        message: 'Image ID must be a valid number'
      });
    }
    
    // Initialize database connection if not already done
    try {
      await pool.query('SELECT 1');
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      return res.status(500).json({
        error: 'Database error',
        message: 'Could not connect to database'
      });
    }

    const result = await pool.query(
      'SELECT image_data, mime_type FROM product_images WHERE id = $1', 
      [parseInt(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Image not found',
        message: 'Image with the specified ID does not exist'
      });
    }

    const { image_data, mime_type } = result.rows[0];
    
    // Set appropriate headers
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

// Import and use other routes with error handling
try {
  const authRoutes = require('./routes/auth');
  const productRoutes = require('./routes/products');
  const reviewRoutes = require('./routes/reviews');
  const orderRoutes = require('./routes/orders');

  app.use('/auth', authRoutes);
  app.use('/products', productRoutes);
  app.use('/reviews', reviewRoutes);
  app.use('/orders', orderRoutes);
} catch (routeError) {
  console.error('Error loading routes:', routeError);
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running on Vercel!',
    version: '1.0.0',
    environment: 'serverless',
    timestamp: new Date().toISOString(),
    limits: {
      maxFileSize: '4MB',
      maxRequestSize: '4MB'
    },
    endpoints: {
      auth: '/api/auth',
      products: '/api/products',
      reviews: '/api/reviews',
      orders: '/api/orders',
      upload: '/api/upload/image',
      image: '/api/image/:id'
    }
  });
});

// Handle favicon requests
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Catch-all for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error occurred:', error);
  
  // Handle request size mismatch specifically
  if (error.message === 'Request size mismatch') {
    return res.status(400).json({
      error: 'Request size mismatch',
      message: 'Content-Length header does not match actual request body size'
    });
  }
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'Image size must be less than 4MB'
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

  // Handle JSON parsing errors
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      error: 'Invalid JSON',
      message: 'Request body contains invalid JSON'
    });
  }

  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

const serverless = require('serverless-http');
module.exports = serverless(app);
