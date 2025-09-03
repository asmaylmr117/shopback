const express = require('express');
const cors = require('cors');
const busboy = require('busboy');
const fs = require('fs');
const path = require('path');

const app = express();

// Initialize variables
let pool, authenticateToken, requireAdmin, requireCustomerOrAdmin;
let databaseInitialized = false;

// Track which routes are loaded successfully
let routesLoaded = {
  auth: false,
  products: false,
  reviews: false,
  orders: false
};

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://shopbackco.vercel.app',
  'https://yourfrontenddomain.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Handle preflight requests
app.options('*', cors());

// ======== التعديل الهام: body-parser مشروط ======== //
// استخدم body-parser لجميع routes باستثناء upload
app.use((req, res, next) => {
  if (req.originalUrl === '/api/upload/image' && req.method === 'POST') {
    // تخطي body-parser لـ upload endpoint
    next();
  } else {
    // استخدام body-parser لباقي الـ endpoints
    express.json({ limit: '10mb' })(req, res, next);
  }
});

app.use((req, res, next) => {
  if (req.originalUrl === '/api/upload/image' && req.method === 'POST') {
    next();
  } else {
    express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
  }
});
// ======== نهاية التعديل ======== //

// Root API endpoint
app.get('/api', (req, res) => {
  res.status(200).json({
    message: 'API root is working fine',
    now: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    databaseInitialized
  });
});

// Environment variables check endpoint
app.get('/api/env-check', (req, res) => {
  res.json({
    message: 'Environment variables check',
    variables: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      JWT_SECRET: !!process.env.JWT_SECRET,
      ADMIN_USERNAME: !!process.env.ADMIN_USERNAME,
      ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
      NODE_ENV: process.env.NODE_ENV || 'development'
    },
    services: {
      database: !!pool,
      databaseInitialized,
      auth: !!authenticateToken
    }
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
        databaseInitialized,
        authenticateToken: !!authenticateToken,
        requireAdmin: !!requireAdmin,
        requireCustomerOrAdmin: !!requireCustomerOrAdmin
      },
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Debug failed',
      message: error.message,
      currentDirectory: __dirname
    });
  }
});

// Database connection test endpoint
app.get('/api/db-test', async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      error: 'Database not available',
      message: 'Database pool not initialized'
    });
  }

  try {
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    res.json({
      message: 'Database connection successful',
      data: result.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({
      error: 'Database connection failed',
      message: error.message
    });
  }
});

// Check database tables endpoint
app.get('/api/check-tables', async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      error: 'Database not available',
      message: 'Database pool not initialized'
    });
  }

  try {
    const tables = ['users', 'products', 'customer_addresses', 'orders', 'order_items', 'reviews', 'product_images'];
    const tableStatus = {};

    for (const table of tables) {
      try {
        const result = await pool.query(
          `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
          [table]
        );
        tableStatus[table] = result.rows[0].exists;
      } catch (error) {
        tableStatus[table] = false;
        console.error(`Error checking table ${table}:`, error.message);
      }
    }

    res.json({
      message: 'Table status check',
      tables: tableStatus,
      databaseInitialized,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Table check error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while checking tables'
    });
  }
});

// Reinitialize database endpoint (for development only)
app.post('/api/reinit-db', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'This endpoint is only available in development mode'
    });
  }

  try {
    const database = require('./config/database');
    console.log('🔄 Reinitializing database...');
    
    await database.initializeDatabase();
    databaseInitialized = true;
    
    res.json({
      message: 'Database reinitialized successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Reinit error:', error);
    res.status(500).json({
      error: 'Reinitialization failed',
      message: error.message
    });
  }
});

// Main health check (root)
app.get('/', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running on Vercel!',
    version: '1.0.0',
    environment: 'serverless',
    status: 'online',
    databaseInitialized,
    apiEndpoint: '/api',
    healthCheck: '/api/health',
    debug: '/api/debug',
    tableCheck: '/api/check-tables'
  });
});

// Test endpoint for basic functionality
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Test endpoint working',
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    databaseInitialized
  });
});

// Image upload endpoint using busboy (works on Vercel)
app.post('/api/upload/image', (req, res) => {
  try {
    console.log('📤 Received upload request');
    
    const bb = busboy({ 
      headers: req.headers,
      limits: {
        fileSize: 4.5 * 1024 * 1024 // 4.5MB limit
      }
    });
    
    let imageBuffer = null;
    let mimeType = '';
    let fileSize = 0;
    let fileName = '';

    bb.on('file', (name, file, info) => {
      console.log('📁 Processing file:', info.filename);
      const { filename, mimeType: fileMimeType } = info;
      mimeType = fileMimeType;
      fileName = filename || 'uploaded_image';
      
      const chunks = [];
      file.on('data', (chunk) => {
        chunks.push(chunk);
        fileSize += chunk.length;
      });
      
      file.on('end', () => {
        imageBuffer = Buffer.concat(chunks);
        console.log(`✅ File processed: ${fileName}, size: ${fileSize} bytes`);
      });
    });

    bb.on('close', async () => {
      try {
        if (!imageBuffer) {
          console.log('❌ No image buffer received');
          return res.status(400).json({
            error: 'Validation error',
            message: 'No image file uploaded'
          });
        }

        if (!pool) {
          console.log('❌ Database pool not available');
          return res.status(503).json({
            error: 'Service unavailable',
            message: 'Database connection not available'
          });
        }

        // Validate file type
        if (!mimeType.startsWith('image/')) {
          console.log('❌ Invalid file type:', mimeType);
          return res.status(400).json({
            error: 'Invalid file type',
            message: 'Only image files are allowed'
          });
        }

        // Validate file size (4.5MB limit)
        if (fileSize > 4.5 * 1024 * 1024) {
          console.log('❌ File too large:', fileSize);
          return res.status(400).json({
            error: 'File too large',
            message: 'Image size must be less than 4.5MB'
          });
        }

        // Test database connection
        await pool.query('SELECT 1');

        const result = await pool.query(
          'INSERT INTO product_images (image_data, mime_type, file_size, original_name) VALUES ($1, $2, $3, $4) RETURNING id',
          [imageBuffer, mimeType, fileSize, fileName]
        );

        console.log('✅ Image saved to database with ID:', result.rows[0].id);

        res.status(201).json({
          message: 'Image uploaded successfully',
          imageId: result.rows[0].id,
          fileName: fileName,
          fileSize: fileSize,
          mimeType: mimeType
        });

      } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({
          error: 'Server error',
          message: 'Failed to process image'
        });
      }
    });

    bb.on('error', (error) => {
      console.error('❌ Busboy error:', error);
      res.status(500).json({
        error: 'Parse error',
        message: 'Failed to parse form data'
      });
    });

    req.pipe(bb);

  } catch (error) {
    console.error('❌ Image upload error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while uploading the image'
    });
  }
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

// Auth Routes
try {
  const authRoutes = require('./routes/auth');
  app.use('/api/auth', authRoutes);
  routesLoaded.auth = true;
  console.log('✅ Auth routes loaded successfully');
} catch (authError) {
  console.error('❌ Failed to load auth routes:', authError.message);
  routesLoaded.auth = false;
}

// Product Routes
try {
  const productRoutes = require('./routes/products');
  app.use('/api/products', productRoutes);
  routesLoaded.products = true;
  console.log('✅ Product routes loaded successfully');
} catch (productError) {
  console.error('❌ Failed to load product routes:', productError.message);
  routesLoaded.products = false;
}

// Review Routes
try {
  const reviewRoutes = require('./routes/reviews');
  app.use('/api/reviews', reviewRoutes);
  routesLoaded.reviews = true;
  console.log('✅ Review routes loaded successfully');
} catch (reviewError) {
  console.error('❌ Failed to load review routes:', reviewError.message);
  routesLoaded.reviews = false;
}

// Order Routes
try {
  const orderRoutes = require('./routes/orders');
  app.use('/api/orders', orderRoutes);
  routesLoaded.orders = true;
  console.log('✅ Order routes loaded successfully');
} catch (orderError) {
  console.error('❌ Failed to load order routes:', orderError.message);
  routesLoaded.orders = false;
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
      databaseInitialized,
      authentication: !!authenticateToken && !!requireAdmin,
      routes: routesLoaded
    },
    environmentVariables: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      JWT_SECRET: !!process.env.JWT_SECRET,
      ADMIN_USERNAME: !!process.env.ADMIN_USERNAME,
      ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD
    },
    endpoints: {
      auth: '/api/auth',
      products: '/api/products',
      reviews: '/api/reviews',
      orders: '/api/orders',
      upload: '/api/upload/image',
      image: '/api/image/:id',
      debug: '/api/debug',
      health: '/api/health',
      tableCheck: '/api/check-tables'
    },
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error occurred:', error);
  
  // معالجة أخطاء busboy الخاصة
  if (error.message.includes('Failed to parse form data')) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Failed to process file upload'
    });
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
    routesStatus: routesLoaded,
    databaseInitialized,
    availableEndpoints: [
      '/api',
      '/api/health',
      '/api/debug',
      '/api/env-check',
      '/api/db-test',
      '/api/check-tables'
    ]
  });
});

// Initialize application
async function initializeApp() {
  try {
    // Load database config
    const database = require('./config/database');
    pool = database.pool;
    console.log('✅ Database config loaded successfully');
    
    // Initialize database tables - WAIT for completion
    if (database.initializeDatabase) {
      console.log('🔄 Initializing database tables...');
      try {
        await database.initializeDatabase();
        databaseInitialized = true;
        console.log('✅ Database initialized successfully');
      } catch (err) {
        console.error('❌ Database initialization failed:', err);
        databaseInitialized = false;
      }
    }
  } catch (dbError) {
    console.error('❌ Failed to load database config:', dbError.message);
  }

  // Load auth middleware with error handling
  try {
    const auth = require('./middleware/auth');
    authenticateToken = auth.authenticateToken;
    requireAdmin = auth.requireAdmin;
    requireCustomerOrAdmin = auth.requireCustomerOrAdmin;
    console.log('✅ Auth middleware loaded successfully');
  } catch (authError) {
    console.error('❌ Failed to load auth middleware:', authError.message);
  }
}

// Start the application
initializeApp().then(() => {
  console.log('🚀 Application initialization completed');
  console.log('📊 Database initialized:', databaseInitialized);
});

module.exports = app;
