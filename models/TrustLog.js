const mongoose = require('mongoose');

const trustLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'admin_adjustment',
      'manual_adjustment'
    ]
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
  },
  points: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for better query performance
trustLogSchema.index({ user: 1, createdAt: -1 });

// Only keep admin/manual adjustment logic
trustLogSchema.statics.logActivity = async function(userId, action, points, description, metadata = {}) {
  try {
    const log = new this({
      user: userId,
      action,
      points,
      description,
      metadata
    });
    await log.save();
    // Admin/manual adjustment: update user's trust score
    if (action === 'admin_adjustment' || action === 'manual_adjustment') {
      const User = require('./User');
      const user = await User.findById(userId);
      if (user) {
        const newScore = Math.max(0, Math.min(100, user.trustScore + points));
        user.trustScore = newScore;
        user.lastActive = new Date();
        await user.save();
      }
    }
    return log;
  } catch (error) {
    console.error('Error logging trust activity:', error);
    throw error;
  }
};

// Static method to get user's trust history
trustLogSchema.statics.getUserTrustHistory = function(userId, limit = 50) {
  return this.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('project', 'title')
    .populate('user', 'name email');
};

module.exports = mongoose.model('TrustLog', trustLogSchema); 