const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { pool } = require('./config/database');
const { authenticateToken, requireAdmin } = require('./middleware/auth');

const app = express();

// Configure multer for serverless environment
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4.5 * 1024 * 1024, // 4.5MB limit for serverless
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourfrontenddomain.com', 'https://yourfrontenddomain.vercel.app']
    : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Database connection helper with timeout
async function connectWithTimeout(timeoutMs = 5000) {
  return Promise.race([
    pool.query('SELECT 1'),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database connection timeout')), timeoutMs)
    )
  ]);
}

// Image upload endpoint
app.post('/upload/image', authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'No image file uploaded'
      });
    }

    const imageBuffer = req.file.buffer;
    
    // Test database connection with timeout
    try {
      await connectWithTimeout(5000);
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      return res.status(500).json({
        error: 'Database error',
        message: 'Could not connect to database'
      });
    }

    const result = await Promise.race([
      pool.query(
        'INSERT INTO product_images (image_data, mime_type, file_size) VALUES ($1, $2, $3) RETURNING id',
        [imageBuffer, req.file.mimetype, req.file.size]
      ),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      )
    ]);

    res.status(201).json({
      message: 'Image uploaded successfully',
      imageId: result.rows[0].id
    });
  } catch (error) {
    console.error('Image upload error:', error);
    
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'File too large',
          message: 'Image size must be less than 4.5MB for serverless deployment'
        });
      }
    }

    if (error.message === 'Database connection timeout' || error.message === 'Query timeout') {
      return res.status(504).json({
        error: 'Database timeout',
        message: 'Database operation timed out'
      });
    }
    
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while uploading the image'
    });
  }
});

// Serve images
app.get('/image/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Test database connection with timeout
    try {
      await connectWithTimeout(5000);
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      return res.status(500).json({
        error: 'Database error',
        message: 'Could not connect to database'
      });
    }

    const result = await Promise.race([
      pool.query(
        'SELECT image_data, mime_type FROM product_images WHERE id = $1', 
        [id]
      ),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      )
    ]);

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
    
    if (error.message === 'Database connection timeout' || error.message === 'Query timeout') {
      return res.status(504).json({
        error: 'Database timeout',
        message: 'Database operation timed out'
      });
    }
    
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
  // Continue without routes if they fail to load
}

// Health check endpoint - simplified to avoid database dependency
app.get('/', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running on Vercel!',
    version: '1.0.0',
    environment: 'serverless',
    timestamp: new Date().toISOString(),
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

// Health check with database test
app.get('/health/database', async (req, res) => {
  try {
    await connectWithTimeout(3000);
    res.json({ 
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error occurred:', error);
  
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

// Export for serverless
const serverless = require('serverless-http');
module.exports = serverless(app);
