const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  messageType: {
    type: String,
    enum: ['text', 'system'],
    default: 'text'
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for better query performance
messageSchema.index({ project: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ createdAt: -1 });

// Method to get messages for a project with pagination
messageSchema.statics.getProjectMessages = function(projectId, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  
  return this.find({ project: projectId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'name email')
    .populate('project', 'title')
    .lean();
};

// Method to get recent messages for a project
messageSchema.statics.getRecentMessages = function(projectId, limit = 20) {
  return this.find({ project: projectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('sender', 'name email')
    .lean();
};

module.exports = mongoose.model('Message', messageSchema); 