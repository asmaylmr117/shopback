const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { pool } = require('./config/database');
const { authenticateToken, requireAdmin } = require('./middleware/auth');

const app = express();

// Configure multer for Vercel with strict limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024, // 4MB - safe for Vercel
    files: 1,
    fields: 10,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    console.log('File received:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourfrontenddomain.com', 'https://yourfrontenddomain.vercel.app']
    : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 86400 // 24 hours
}));

// Handle preflight requests
app.options('*', cors());

// Body parser with size verification removed
app.use(express.json({ limit: '4mb' })); // Removed verify function
app.use(express.urlencoded({ extended: true, limit: '4mb' })); // Removed verify function

// Enhanced request logging
app.use((req, res, next) => {
  console.log('Incoming request:', {
    method: req.method,
    url: req.url,
    path: req.path,
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  
  // Set timeout for long-running requests
  req.setTimeout(25000, () => {
    console.error('Request timeout');
    res.status(408).json({ error: 'Request timeout' });
  });
  
  next();
});

// Health check - must be before other routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'E-commerce API Server is running on Vercel!',
    version: '1.0.0',
    environment: 'serverless',
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    limits: {
      maxFileSize: '4MB',
      maxRequestSize: '4MB'
    },
    endpoints: {
      auth: '/auth',
      products: '/products',
      reviews: '/reviews',
      orders: '/orders',
      upload: '/upload/image',
      image: '/image/:id'
    }
  });
});

// Image upload endpoint with comprehensive error handling
app.post('/upload/image', (req, res, next) => {
  console.log('Upload request started');
  
  // Apply authentication middleware
  authenticateToken(req, res, (authErr) => {
    if (authErr) return next(authErr);
    
    requireAdmin(req, res, (adminErr) => {
      if (adminErr) return next(adminErr);
      
      // Apply multer middleware
      upload.single('image')(req, res, (uploadErr) => {
        if (uploadErr) {
          console.error('Multer error:', uploadErr);
          
          if (uploadErr instanceof multer.MulterError) {
            switch (uploadErr.code) {
              case 'LIMIT_FILE_SIZE':
                return res.status(400).json({
                  error: 'File too large',
                  message: 'Image size must be less than 4MB'
                });
              case 'LIMIT_UNEXPECTED_FILE':
                return res.status(400).json({
                  error: 'Unexpected field',
                  message: 'Only one image file is allowed in the "image" field'
                });
              case 'LIMIT_FIELD_COUNT':
                return res.status(400).json({
                  error: 'Too many fields',
                  message: 'Maximum 10 form fields allowed'
                });
              default:
                return res.status(400).json({
                  error: 'Upload error',
                  message: uploadErr.message
                });
            }
          }
          
          return res.status(400).json({
            error: 'Upload error',
            message: uploadErr.message
          });
        }
        
        next();
      });
    });
  });
}, async (req, res) => {
  try {
    console.log('Processing uploaded file');
    
    if (!req.file) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'No image file uploaded'
      });
    }

    const imageBuffer = req.file.buffer;
    console.log('File processed:', {
      size: imageBuffer.length,
      mimetype: req.file.mimetype,
      originalName: req.file.originalname
    });
    
    // Double-check buffer size
    if (imageBuffer.length > 4 * 1024 * 1024) {
      return res.status(400).json({
        error: 'File too large',
        message: 'Image size exceeds 4MB limit'
      });
    }
    
    // Test database connection
    try {
      await pool.query('SELECT 1');
      console.log('Database connection successful');
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      return res.status(500).json({
        error: 'Database error',
        message: 'Could not connect to database'
      });
    }

    // Insert image
    const result = await pool.query(
      'INSERT INTO product_images (image_data, mime_type, file_size) VALUES ($1, $2, $3) RETURNING id',
      [imageBuffer, req.file.mimetype, req.file.size]
    );

    console.log('Image saved with ID:', result.rows[0].id);
    
    res.status(201).json({
      message: 'Image uploaded successfully',
      imageId: result.rows[0].id
    });
  } catch (error) {
    console.error('Image upload processing error:', error);
    
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while processing the image'
    });
  }
});

// Serve images
app.get('/image/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Image request for ID:', id);
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        error: 'Invalid ID',
        message: 'Image ID must be a valid number'
      });
    }
    
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
    
    res.set({
      'Content-Type': mime_type,
      'Cache-Control': 'public, max-age=31536000',
      'Content-Length': image_data.length.toString(),
      'ETag': `"${id}-${image_data.length}"`
    });
    
    res.send(image_data);
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving the image'
    });
  }
});

// Load other routes with better error handling
const routeModules = [
  { path: '/auth', module: './routes/auth' },
  { path: '/products', module: './routes/products' },
  { path: '/reviews', module: './routes/reviews' },
  { path: '/orders', module: './routes/orders' }
];

routeModules.forEach(({ path, module }) => {
  try {
    const routes = require(module);
    app.use(path, routes);
    console.log(`Loaded routes: ${path}`);
  } catch (routeError) {
    console.error(`Error loading ${path} routes:`, routeError);
  }
});

// Handle favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// 404 handler
app.use('*', (req, res) => {
  console.log('Route not found:', req.originalUrl);
  res.status(404).json({
    error: 'Route not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', {
    message: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method
  });
  
  // Handle specific error types
  if (error.message === 'Request size mismatch') {
    return res.status(400).json({
      error: 'Request size mismatch',
      message: 'Content-Length header does not match actual request body size'
    });
  }
  
  if (error.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      error: 'Invalid CSRF token',
      message: 'Request forbidden'
    });
  }
  
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      error: 'Invalid JSON',
      message: 'Request body contains invalid JSON'
    });
  }

  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    requestId: req.headers['x-vercel-id'] || 'unknown'
  });
});

// For Vercel deployment
if (process.env.NODE_ENV === 'production') {
  const serverless = require('serverless-http');
  module.exports = serverless(app);
} else {
  // For local development
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
  module.exports = app;
}
