const express = require('express');
const { body, param } = require('express-validator');
const { protect } = require('../middleware/auth');
const Message = require('../models/Message');
const Project = require('../models/Project');
const router = express.Router();

// @route   GET /api/messages/:projectId
// @desc    Get messages for a project
// @access  Private
router.get('/:projectId', [
  protect,
  param('projectId').isMongoId().withMessage('Invalid project ID')
], async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    console.log('Fetching messages for project:', projectId, 'User:', req.user._id);

    // Check if user has access to the project
    const project = await Project.findById(projectId);
    console.log('Project found:', !!project, project && project._id.toString());
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    if (!project.canView(req.user._id)) {
      console.log('User does not have access:', req.user._id);
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this project'
      });
    }

    // Get messages with pagination
    const messages = await Message.getProjectMessages(projectId, parseInt(page), parseInt(limit));
    
    // Reverse the order to show oldest first
    const reversedMessages = messages.reverse();

    res.json({
      success: true,
      messages: reversedMessages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: messages.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/messages/:projectId
// @desc    Send a message to a project
// @access  Private
router.post('/:projectId', [
  protect,
  param('projectId').isMongoId().withMessage('Invalid project ID'),
  body('content').trim().isLength({ min: 1, max: 1000 }).withMessage('Message must be between 1 and 1000 characters')
], async (req, res) => {
  try {
    const { projectId } = req.params;
    const { content } = req.body;
    console.log('Sending message to project:', projectId, 'User:', req.user._id);

    // Check if user has access to the project
    const project = await Project.findById(projectId);
    console.log('Project found:', !!project, project && project._id.toString());
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    if (!project.canView(req.user._id)) {
      console.log('User does not have access:', req.user._id);
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this project'
      });
    }

    // Create the message
    const message = new Message({
      project: projectId,
      sender: req.user._id,
      content: content.trim()
    });

    await message.save();

    // Populate sender info for the response
    await message.populate('sender', 'name email');

    res.status(201).json({
      success: true,
      message: message
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/messages/:messageId
// @desc    Edit a message
// @access  Private
router.put('/:messageId', [
  protect,
  param('messageId').isMongoId().withMessage('Invalid message ID'),
  body('content').trim().isLength({ min: 1, max: 1000 }).withMessage('Message must be between 1 and 1000 characters')
], async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is the sender
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own messages'
      });
    }

    // Update the message
    message.content = content.trim();
    message.isEdited = true;
    message.editedAt = new Date();

    await message.save();
    await message.populate('sender', 'name email');

    res.json({
      success: true,
      message: message
    });
  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/messages/:messageId
// @desc    Delete a message
// @access  Private
router.delete('/:messageId', [
  protect,
  param('messageId').isMongoId().withMessage('Invalid message ID')
], async (req, res) => {
  try {
    const { messageId } = req.params;

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is the sender or project owner
    const project = await Project.findById(message.project);
    const isOwner = project && project.owner.toString() === req.user._id.toString();
    const isSender = message.sender.toString() === req.user._id.toString();

    if (!isSender && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own messages or be the project owner'
      });
    }

    await Message.findByIdAndDelete(messageId);

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router; 