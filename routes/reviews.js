const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// SPECIFIC ROUTES FIRST

// Get reviews statistics (admin only) - SPECIFIC ROUTE FIRST
router.get('/stats/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM reviews');
    const avgRatingResult = await pool.query('SELECT AVG(rating) as avg_rating FROM reviews');
    const ratingDistResult = await pool.query(`
      SELECT rating, COUNT(*) as count 
      FROM reviews 
      GROUP BY rating 
      ORDER BY rating DESC
    `);

    res.json({
      message: 'Review statistics retrieved successfully',
      stats: {
        totalReviews: parseInt(totalResult.rows[0].total),
        averageRating: parseFloat(avgRatingResult.rows[0].avg_rating || 0).toFixed(1),
        ratingDistribution: ratingDistResult.rows
      }
    });
  } catch (error) {
    console.error('Get review stats error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving review statistics'
    });
  }
});

// Get all reviews (public route)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const offset = (page - 1) * limit;
    
    const result = await pool.query(`
      SELECT * FROM reviews 
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // Get total count for pagination
    const countResult = await pool.query('SELECT COUNT(*) FROM reviews');
    const totalReviews = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalReviews / limit);

    res.json({
      message: 'Reviews retrieved successfully',
      reviews: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalReviews,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving reviews'
    });
  }
});

// Add new review (public route - anyone can add a review)
router.post('/', async (req, res) => {
  try {
    const { name, review, rating = 5 } = req.body;

    // Validate required fields
    if (!name || !review) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Name and review text are required'
      });
    }

    // Validate rating
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Rating must be between 1 and 5'
      });
    }

    const result = await pool.query(`
      INSERT INTO reviews (name, review, rating)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [name, review, rating]);

    res.status(201).json({
      message: 'Review created successfully',
      review: result.rows[0]
    });
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while creating the review'
    });
  }
});

// Get review by ID (public route) - MUST come after specific routes
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM reviews WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Review not found',
        message: 'Review with the specified ID does not exist'
      });
    }

    res.json({
      message: 'Review retrieved successfully',
      review: result.rows[0]
    });
  } catch (error) {
    console.error('Get review error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while retrieving the review'
    });
  }
});

// Update review (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, review, rating } = req.body;

    // Check if review exists
    const existingReview = await pool.query('SELECT * FROM reviews WHERE id = $1', [id]);
    
    if (existingReview.rows.length === 0) {
      return res.status(404).json({
        error: 'Review not found',
        message: 'Review with the specified ID does not exist'
      });
    }

    // Build update query dynamically
    let updateFields = [];
    let queryParams = [];
    let paramCount = 0;

    if (name !== undefined) {
      paramCount++;
      updateFields.push(`name = $${paramCount}`);
      queryParams.push(name);
    }

    if (review !== undefined) {
      paramCount++;
      updateFields.push(`review = $${paramCount}`);
      queryParams.push(review);
    }

    if (rating !== undefined) {
      if (rating < 1 || rating > 5) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Rating must be between 1 and 5'
        });
      }
      paramCount++;
      updateFields.push(`rating = $${paramCount}`);
      queryParams.push(rating);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'At least one field must be provided for update'
      });
    }

    // Add review ID for WHERE clause
    paramCount++;
    queryParams.push(id);

    const query = `
      UPDATE reviews 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, queryParams);

    res.json({
      message: 'Review updated successfully',
      review: result.rows[0]
    });
  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while updating the review'
    });
  }
});

// Delete review (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if review exists
    const existingReview = await pool.query('SELECT * FROM reviews WHERE id = $1', [id]);
    
    if (existingReview.rows.length === 0) {
      return res.status(404).json({
        error: 'Review not found',
        message: 'Review with the specified ID does not exist'
      });
    }

    await pool.query('DELETE FROM reviews WHERE id = $1', [id]);

    res.json({
      message: 'Review deleted successfully',
      deletedReview: existingReview.rows[0]
    });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while deleting the review'
    });
  }
});

module.exports = router;