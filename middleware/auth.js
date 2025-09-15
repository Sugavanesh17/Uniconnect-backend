const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware to protect routes
const protect = async (req, res, next) => {
  let token;

  // Check for token in headers
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({ message: 'User not found' });
      }

      if (!req.user.isActive) {
        return res.status(401).json({ message: 'Account is deactivated' });
      }

      next();
    } catch (error) {
      console.error('Token verification error:', error);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

// Middleware to check if user is admin
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
  }
};

// Middleware to check if user is project owner
const projectOwner = async (req, res, next) => {
  try {
    const Project = require('../models/Project');
    const project = await Project.findById(req.params.projectId);
    
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied. Project owner privileges required.' });
    }

    req.project = project;
    next();
  } catch (error) {
    console.error('Project owner check error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Middleware to check if user can edit project
const canEditProject = async (req, res, next) => {
  try {
    const Project = require('../models/Project');
    const project = await Project.findById(req.params.projectId);
    
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (!project.canEdit(req.user._id)) {
      return res.status(403).json({ message: 'Access denied. Edit privileges required.' });
    }

    req.project = project;
    next();
  } catch (error) {
    console.error('Project edit check error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Middleware to check if user can view project details (members only)
const canViewProjectDetails = async (req, res, next) => {
  try {
    const Project = require('../models/Project');
    const project = await Project.findById(req.params.projectId);
    
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Check if project is deleted
    if (project.isDeleted) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Allow project owner to view details
    if (project.owner.toString() === req.user._id.toString()) {
      req.project = project;
      return next();
    }

    // Check if user is a member of the project
    const isMember = project.members.some(member => 
      member.user.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({ 
        message: 'You must be a member of this project to view its details. Please request to join first.',
        requiresJoin: true
      });
    }

    req.project = project;
    next();
  } catch (error) {
    console.error('Project details view check error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Middleware to check if user can view project (for basic info like title, description)
const canViewProject = async (req, res, next) => {
  try {
    const Project = require('../models/Project');
    const project = await Project.findById(req.params.projectId);
    
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (!project.canView(req.user._id)) {
      return res.status(403).json({ message: 'Access denied. View privileges required.' });
    }

    req.project = project;
    next();
  } catch (error) {
    console.error('Project view check error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Middleware to check if user has signed NDA for private project
const hasSignedNDA = async (req, res, next) => {
  try {
    if (req.project.privacy === 'private') {
      const member = req.project.members.find(m => 
        m.user.toString() === req.user._id.toString()
      );
      
      if (!member || !member.hasSignedNDA) {
        return res.status(403).json({ 
          message: 'NDA agreement required to view this private project',
          requiresNDA: true
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('NDA check error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  protect,
  admin,
  projectOwner,
  canEditProject,
  canViewProject,
  canViewProjectDetails,
  hasSignedNDA
}; 