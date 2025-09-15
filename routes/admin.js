const express = require('express');
const { body, validationResult } = require('express-validator');
const { protect, admin } = require('../middleware/auth');
const User = require('../models/User');
const Project = require('../models/Project');
const TrustLog = require('../models/TrustLog');
const Report = require('../models/Report');
const Notification = require('../models/Notification');

const router = express.Router();

// Apply admin middleware to all routes
router.use(protect, admin);

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard stats
// @access  Private (Admin only)
router.get('/dashboard', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const verifiedUsers = await User.countDocuments({ isEmailVerified: true });
    
    const totalProjects = await Project.countDocuments({ isDeleted: false });
    const publicProjects = await Project.countDocuments({ privacy: 'public', isDeleted: false });
    const privateProjects = await Project.countDocuments({ privacy: 'private', isDeleted: false });
    
    const avgTrustScore = await User.aggregate([
      { $group: { _id: null, avgTrust: { $avg: '$trustScore' } } }
    ]);

    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('name email university trustScore createdAt');

    const recentProjects = await Project.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('owner', 'name email')
      .select('title privacy status createdAt');

    res.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          active: activeUsers,
          verified: verifiedUsers,
          avgTrustScore: avgTrustScore[0]?.avgTrust || 0
        },
        projects: {
          total: totalProjects,
          public: publicProjects,
          private: privateProjects
        }
      },
      recentUsers,
      recentProjects
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users (admin view)
// @access  Private (Admin only)
router.get('/users', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      status, 
      university,
      sort = 'createdAt',
      order = 'desc'
    } = req.query;

    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { university: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (university) query.university = { $regex: university, $options: 'i' };

    const sortOptions = {};
    sortOptions[sort] = order === 'desc' ? -1 : 1;

    const users = await User.find(query)
      .select('-password')
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   GET /api/admin/projects
// @desc    Get all projects (admin view)
// @access  Private (Admin only)
router.get('/projects', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      privacy, 
      status,
      sort = 'createdAt',
      order = 'desc'
    } = req.query;

    const query = { isDeleted: false };
    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (privacy) query.privacy = privacy;
    if (status) query.status = status;

    const sortOptions = {};
    sortOptions[sort] = order === 'desc' ? -1 : 1;

    const projects = await Project.find(query)
      .populate('owner', 'name email university')
      .populate('members.user', 'name email university')
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Project.countDocuments(query);

    res.json({
      success: true,
      projects,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   PUT /api/admin/users/:userId/trust-score
// @desc    Adjust user trust score
// @access  Private (Admin only)
router.put('/users/:userId/trust-score', [
  body('points').isInt({ min: -100, max: 100 }).withMessage('Points must be between -100 and 100'),
  body('reason').trim().isLength({ min: 5, max: 200 }).withMessage('Reason must be between 5 and 200 characters')
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

    const { points, reason } = req.body;
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Log admin trust adjustment
    await TrustLog.logActivity(
      user._id,
      'admin_adjustment',
      points,
      `Admin adjustment: ${reason}`,
      { 
        adjustedBy: req.user._id,
        reason: reason
      }
    );

    res.json({
      success: true,
      message: 'Trust score adjusted successfully',
      newTrustScore: user.trustScore + points
    });
  } catch (error) {
    console.error('Adjust trust score error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   PUT /api/admin/users/:userId/status
// @desc    Toggle user account status
// @access  Private (Admin only)
router.put('/users/:userId/status', [
  body('isActive').isBoolean().withMessage('isActive must be a boolean')
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

    const { isActive } = req.body;
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    user.isActive = isActive;
    await user.save();

    res.json({
      success: true,
      message: `User account ${isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   PUT /api/admin/users/:userId/role
// @desc    Change user role
// @access  Private (Admin only)
router.put('/users/:userId/role', [
  body('role').isIn(['user', 'admin']).withMessage('Role must be user or admin')
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

    const { role } = req.body;
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    user.role = role;
    await user.save();

    res.json({
      success: true,
      message: `User role changed to ${role} successfully`
    });
  } catch (error) {
    console.error('Change user role error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   DELETE /api/admin/projects/:projectId
// @desc    Delete project (admin override)
// @access  Private (Admin only)
router.delete('/projects/:projectId', async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    
    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: 'Project not found' 
      });
    }

    project.isDeleted = true;
    project.status = 'cancelled';
    await project.save();

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   GET /api/admin/trust-logs
// @desc    Get trust logs for monitoring
// @access  Private (Admin only)
router.get('/trust-logs', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      userId,
      action,
      sort = 'createdAt',
      order = 'desc'
    } = req.query;

    const query = {};
    
    if (userId) query.user = userId;
    if (action) query.action = action;

    const sortOptions = {};
    sortOptions[sort] = order === 'desc' ? -1 : 1;

    const logs = await TrustLog.find(query)
      .populate('user', 'name email university')
      .populate('project', 'title')
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await TrustLog.countDocuments(query);

    res.json({
      success: true,
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get trust logs error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// @route   GET /api/admin/reports
// @desc    List all user reports
// @access  Private (Admin only)
router.get('/reports', protect, admin, async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('reportedUser', 'name email')
      .populate('reportedBy', 'name email')
      .populate('project', 'title')
      .sort({ status: 1, createdAt: -1 });
    res.json({ reports });
  } catch (error) {
    console.error('Fetch reports error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/admin/reports/:reportId/resolve
// @desc    Resolve a user report
// @access  Private (Admin only)
router.put('/reports/:reportId/resolve', protect, admin, async (req, res) => {
  try {
    const { adminNote } = req.body;
    const report = await Report.findById(req.params.reportId);
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }
    report.status = 'resolved';
    report.adminNote = adminNote || '';
    report.resolvedBy = req.user._id;
    report.resolvedAt = new Date();
    await report.save();
    const project = await Project.findById(report.project).populate('owner', 'name');
    const reportedUser = await User.findById(report.reportedUser);
    const notification = await Notification.create({
      user: report.reportedBy,
      type: 'report_resolved',
      message: `Your report on user ${reportedUser.name} in project "${project.title}" has been resolved by admin.`,
      report: report._id
    });
    res.json({ success: true, message: 'Report resolved', report });
  } catch (error) {
    console.error('Resolve report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;