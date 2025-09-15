const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  university: {
    type: String,
    required: [true, 'University is required'],
    trim: true
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio cannot exceed 500 characters'],
    default: ''
  },
  skills: [{
    type: String,
    trim: true
  }],
  github: {
    type: String,
    trim: true,
    match: [/^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9-]+$/, 'Please enter a valid GitHub URL']
  },
  linkedin: {
    type: String,
    trim: true,
    match: [/^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+$/, 'Please enter a valid LinkedIn URL']
  },
  trustScore: {
    type: Number,
    default: 30,
    min: [0, 'Trust score cannot be negative'],
    max: [100, 'Trust score cannot exceed 100']
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  profilePicture: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

/* Removed duplicate index on email to fix mongoose warning */
// Index for better query performance
// userSchema.index({ email: 1 });
userSchema.index({ university: 1 });
userSchema.index({ skills: 1 });
userSchema.index({ trustScore: -1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to update trust score
userSchema.methods.updateTrustScore = function(points) {
  this.trustScore = Math.max(0, Math.min(100, this.trustScore + points));
  return this.save();
};

// Virtual for public profile (excludes sensitive data)
userSchema.virtual('publicProfile').get(function() {
  return {
    _id: this._id,
    name: this.name,
    university: this.university,
    bio: this.bio,
    skills: this.skills,
    github: this.github,
    linkedin: this.linkedin,
    trustScore: this.trustScore,
    isEmailVerified: this.isEmailVerified,
    profilePicture: this.profilePicture,
    createdAt: this.createdAt
  };
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('User', userSchema);