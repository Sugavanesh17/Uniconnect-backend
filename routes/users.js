const express = require('express');
const { body, validationResult } = require('express-validator');
const { protect, admin } = require('../middleware/auth');
const User = require('../models/User');
const TrustLog = require('../models/TrustLog');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const TrustVote = require('../models/TrustVote');
const Project = require('../models/Project');

const router = express.Router();

// @route   GET /api/users
// @desc    Get all users (with filtering and pagination)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { search, role, university, skills, page = 1, limit = 20 } = req.query;
    
    // Build filter object
    const filter = {};
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { university: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) {
      filter.role = role;
    }
    
    if (university) {
      filter.university = { $regex: university, $options: 'i' };
    }
    
    if (skills) {
      filter.skills = { $in: skills.split(',').map(skill => new RegExp(skill.trim(), 'i')) };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    
    // Get users with pagination
    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const total = await User.countDocuments(filter);
    
    res.json({
      users,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasNextPage: skip + users.length < total,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/profile
// @desc    Get current user profile
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    res.json({
      success: true,
      user: user.publicProfile
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', [
  protect,
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('bio').optional().isLength({ max: 500 }).withMessage('Bio cannot exceed 500 characters'),
  body('university').optional().trim().notEmpty().withMessage('University is required'),
  body('skills').optional().isArray().withMessage('Skills must be an array'),
  body('github').optional().isURL().withMessage('Please enter a valid GitHub URL'),
  body('linkedin').optional().isURL().withMessage('Please enter a valid LinkedIn URL')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { name, bio, university, skills, github, linkedin } = req.body;
    
    // Get current user data to check if profile was previously incomplete
    const currentUser = await User.findById(req.user._id);
    const wasProfileIncomplete = !currentUser.bio && !currentUser.skills?.length && !currentUser.github && !currentUser.linkedin;
    
    const updateFields = {};
    if (name) updateFields.name = name;
    if (bio !== undefined) updateFields.bio = bio;
    if (university) updateFields.university = university;
    if (skills) updateFields.skills = skills;
    if (github !== undefined) updateFields.github = github;
    if (linkedin !== undefined) updateFields.linkedin = linkedin;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateFields,
      { new: true, runValidators: true }
    );

    // Log trust activity for profile completion if this is the first time
    if (wasProfileIncomplete && (bio || skills?.length || github || linkedin)) {
      const TrustLog = require('../models/TrustLog');
      await TrustLog.logActivity(
        req.user._id,
        'profile_completed',
        TrustLog.getPointsForAction('profile_completed'),
        'Profile completed with additional information'
      );
      
      // Refresh user data to get updated trust score
      await user.reload();
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        university: user.university,
        bio: user.bio,
        skills: user.skills,
        github: user.github,
        linkedin: user.linkedin,
        trustScore: user.trustScore,
        isEmailVerified: user.isEmailVerified,
        role: user.role,
        profilePicture: user.profilePicture,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   GET /api/users/search
// @desc    Search users by skills or university
// @access  Private
router.get('/search', protect, async (req, res) => {
  try {
    const { skills, university, limit = 10 } = req.query;
    
    const query = { isActive: true };
    
    if (skills) {
      const skillsArray = skills.split(',').map(skill => skill.trim());
      query.skills = { $in: skillsArray };
    }
    
    if (university) {
      query.university = { $regex: university, $options: 'i' };
    }

    const users = await User.find(query)
      .select('name university skills trustScore isEmailVerified')
      .limit(parseInt(limit))
      .sort({ trustScore: -1 });

    res.json({
      success: true,
      users,
      count: users.length
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   GET /api/users/trust-history
// @desc    Get user's trust score history
// @access  Private
router.get('/trust-history', protect, async (req, res) => {
  try {
    const TrustLog = require('../models/TrustLog');
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }
    
    const history = await TrustLog.getUserTrustHistory(req.user._id, 20);
    
    res.json({
      success: true,
      history: history
    });
  } catch (error) {
    console.error('Get trust history error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   GET /api/users/trust-stats
// @desc    Get user's trust statistics
// @access  Private
router.get('/trust-stats', protect, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }
    
    const trustStats = await TrustLog.getTrustStats(req.user._id, parseInt(days));
    
    res.json({
      success: true,
      trustStats
    });
  } catch (error) {
    console.error('Get trust stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   GET /api/users/notifications
// @desc    Get notifications for the logged-in user
// @access  Private
router.get('/notifications', protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ notifications });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/:id
// @desc    Get user by ID (public profile)
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      user: user.publicProfile
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, university, bio, skills, github, linkedin } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      university,
      bio,
      skills: skills || [],
      github,
      linkedin,
      trustScore: 50, // Starting trust score
      role: 'user'
    });

    await user.save();

    // Create JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Log trust score change
    await TrustLog.create({
      user: user._id,
      action: 'account_created',
      points: 50,
      description: 'Account created - initial trust score'
    });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        university: user.university,
        trustScore: user.trustScore,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Create JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        university: user.university,
        trustScore: user.trustScore,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's trust log
router.get('/trust-log', protect, async (req, res) => {
  try {
    const logs = await TrustLog.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json({ logs });
  } catch (error) {
    console.error('Error fetching trust log:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Get all users (admin only)
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ users });
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Update user role
router.put('/admin/:userId/role', protect, admin, async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'User role updated successfully',
      user
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/trust/vote
// @desc    Upvote or downvote a user in a project
// @access  Private
router.post('/trust/vote', protect, async (req, res) => {
  try {
    const { targetId, projectId, vote } = req.body;
    if (![1, -1].includes(vote)) {
      return res.status(400).json({ message: 'Vote must be 1 (upvote) or -1 (downvote)' });
    }
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot vote for yourself' });
    }
    // Only allow voting for project members
    const project = await Project.findById(projectId);
    if (!project || !project.members.some(m => m.user.toString() === targetId)) {
      return res.status(400).json({ message: 'Target user is not a member of this project' });
    }
    // Upsert vote
    const trustVote = await TrustVote.findOneAndUpdate(
      { voter: req.user._id, target: targetId, project: projectId },
      { vote },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, trustVote });
  } catch (error) {
    console.error('Trust vote error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/trust/:userId
// @desc    Get a user’s trust score and recent votes
// @access  Private
router.get('/trust/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    // Get all votes for this user
    const votes = await TrustVote.find({ target: userId });
    const upvotes = votes.filter(v => v.vote === 1).length;
    const downvotes = votes.filter(v => v.vote === -1).length;
    const base = 30;
    const weight = 5;
    let trustScore = base + (upvotes - downvotes) * weight;
    trustScore = Math.max(0, Math.min(100, trustScore));
    res.json({ trustScore, upvotes, downvotes, recentVotes: votes.slice(-10).reverse() });
  } catch (error) {
    console.error('Get trust score error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 