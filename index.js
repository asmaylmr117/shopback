const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Import database and auth middleware with error handling
let pool, authenticateToken, requireAdmin;

try {
  const database = require('./config/database');
  pool = database.pool;
  console.log('✅ Database config loaded successfully');
} catch (dbError) {
  console.error('❌ Failed to load database config:', dbError.message);
}

try {
  const auth = require('./middleware/auth');
  authenticateToken = auth.authenticateToken;
  requireAdmin = auth.requireAdmin;
  console.log('✅ Auth middleware loaded successfully');
} catch (authError) {
  console.error('❌ Failed to load auth middleware:', authError.message);
}

const app = express();

// Root API endpoint
app.get('/api', (req, res) => {
  res.status(200).json({
    message: '🟢 API root is working fine',
    now: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Debug endpoint to check file structure
app.get('/api/debug', (req, res) => {
  try {
    const currentDir = __dirname;
    const routesPath = path.join(currentDir, 'routes');
    const middlewarePath = path.join(currentDir, 'middleware');
    const configPath = path.join(currentDir, 'config');
    
    let routeFiles = [];
    let middlewareFiles = [];
    let configFiles = [];
    let routesExists = false;
    let middlewareExists = false;
    let configExists = false;

    try {
      routeFiles = fs.readdirSync(routesPath);
      routesExists = true;
    } catch (routeError) {
      console.log('Routes directory not found or not accessible');
    }

    try {
      middlewareFiles = fs.readdirSync(middlewarePath);
      middlewareExists = true;
    } catch (middlewareError) {
      console.log('Middleware directory not found or not accessible');
    }

    try {
      configFiles = fs.readdirSync(configPath);
      configExists = true;
    } catch (configError) {
      console.log('Config directory not found or not accessible');
    }

    res.json({
      message: 'Debug information',
      currentDirectory: currentDir,
      directories: {
        routes: {
          path: routesPath,
          exists: routesExists,
          files: routeFiles
        },
        middleware: {
          path: middlewarePath,
          exists: middlewareExists,
          files: middlewareFiles
        },
        config: {
          path: configPath,
          exists: configExists,
          files: configFiles
        }
      },
      loadedModules: {
        database: !!pool,
        authenticateToken: !!authenticateToken,
        requireAdmin: !!requireAdmin
      },
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version
    });
  } catch (error) {
    res.status(500).json({
      error: 'Debug failed',
      message: error.message,
      currentDirectory: __dirname
    });
  }
});

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

// Image upload endpoint
app.post('/api/upload/image', async (req, res) => {
  // Check if required middleware is loaded
  if (!authenticateToken || !requireAdmin || !pool) {
    return res.status(503).json({
      error: 'Service unavailable',
      message: 'Required dependencies not loaded properly'
    });
  }

  upload.single('image')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File too large',
            message: 'Image size must be less than 4.5MB for serverless deployment'
          });
        }
      }
      if (err.message === 'Only image files are allowed') {
        return res.status(400).json({
          error: 'Invalid file type',
          message: 'Only image files are allowed'
        });
      }
      return res.status(400).json({
        error: 'Upload error',
        message: err.message
      });
    }

    try {
      // Apply authentication middleware
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
            
            // Test database connection
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
});

// Serve images
app.get('/api/image/:id', async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      error: 'Service unavailable',
      message: 'Database connection not available'
    });
  }

  try {
    const { id } = req.params;
    
    // Test database connection
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

// Load and use route files with individual error handling
let routesLoaded = {
  auth: false,
  products: false,
  reviews: false,
  orders: false
};

// Auth Routes
try {
  const authRoutes = require('./routes/auth');
  app.use('/api/auth', authRoutes);
  routesLoaded.auth = true;
  console.log('✅ Auth routes loaded successfully');
} catch (authError) {
  console.error('❌ Failed to load auth routes:', authError.message);
  
  // Fallback auth routes for basic functionality
  app.post('/api/auth/admin/login', (req, res) => {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Auth service is currently unavailable',
      debug: 'Auth routes failed to load: ' + authError.message
    });
  });
  
  app.post('/api/auth/customer/login', (req, res) => {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Auth service is currently unavailable',
      debug: 'Auth routes failed to load: ' + authError.message
    });
  });
  
  app.post('/api/auth/customer/register', (req, res) => {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Auth service is currently unavailable',
      debug: 'Auth routes failed to load: ' + authError.message
    });
  });
  
  app.get('/api/auth/profile', (req, res) => {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Auth service is currently unavailable',
      debug: 'Auth routes failed to load: ' + authError.message
    });
  });
}

// Product Routes
try {
  const productRoutes = require('./routes/products');
  app.use('/api/products', productRoutes);
  routesLoaded.products = true;
  console.log('✅ Product routes loaded successfully');
} catch (productError) {
  console.error('❌ Failed to load product routes:', productError.message);
  
  // Fallback product routes
  app.get('/api/products', (req, res) => {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Product service is currently unavailable',
      debug: 'Product routes failed to load: ' + productError.message
    });
  });
  
  app.get('/api/products/meta/categories', (req, res) => {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Product service is currently unavailable',
      debug: 'Product routes failed to load: ' + productError.message
    });
  });
}

// Review Routes
try {
  const reviewRoutes = require('./routes/reviews');
  app.use('/api/reviews', reviewRoutes);
  routesLoaded.reviews = true;
  console.log('✅ Review routes loaded successfully');
} catch (reviewError) {
  console.error('❌ Failed to load review routes:', reviewError.message);
  
  // Fallback review routes
  app.get('/api/reviews', (req, res) => {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Review service is currently unavailable',
      debug: 'Review routes failed to load: ' + reviewError.message
    });
  });
}

// Order Routes
try {
  const orderRoutes = require('./routes/orders');
  app.use('/api/orders', orderRoutes);
  routesLoaded.orders = true;
  console.log('✅ Order routes loaded successfully');
} catch (orderError) {
  console.error('❌ Failed to load order routes:', orderError.message);
  
  // Fallback order routes
  app.get('/api/orders', (req, res) => {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Order service is currently unavailable',
      debug: 'Order routes failed to load: ' + orderError.message
    });
  });
  
  app.get('/api/orders/addresses', (req, res) => {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Order service is currently unavailable',
      debug: 'Order routes failed to load: ' + orderError.message
    });
  });
}

// Health check endpoint with detailed status
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running on Vercel!',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    status: 'healthy',
    services: {
      database: !!pool,
      authentication: !!authenticateToken && !!requireAdmin,
      routes: routesLoaded
    },
    endpoints: {
      auth: '/api/auth',
      products: '/api/products',
      reviews: '/api/reviews',
      orders: '/api/orders',
      upload: '/api/upload/image',
      image: '/api/image/:id',
      debug: '/api/debug',
      health: '/api/health'
    },
    timestamp: new Date().toISOString()
  });
});

// Main health check (root)
app.get('/', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running on Vercel!',
    version: '1.0.0',
    environment: 'serverless',
    status: 'online',
    apiEndpoint: '/api',
    healthCheck: '/api/health',
    debug: '/api/debug'
  });
});

// Test endpoint for basic functionality
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Test endpoint working',
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url
  });
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

// Handle 404s
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist',
    requestedPath: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      '/api',
      '/api/auth/admin/login',
      '/api/auth/customer/login',
      '/api/auth/customer/register',
      '/api/products',
      '/api/reviews',
      '/api/orders',
      '/api/debug',
      '/api/health'
    ]
  });
});

module.exports = app;
