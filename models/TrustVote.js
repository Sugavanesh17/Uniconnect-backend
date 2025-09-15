const mongoose = require('mongoose');
const trustVoteSchema = new mongoose.Schema({
  voter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  vote: { type: Number, enum: [1, -1], required: true }, // 1 = upvote, -1 = downvote
  createdAt: { type: Date, default: Date.now }
});
trustVoteSchema.index({ voter: 1, target: 1, project: 1 }, { unique: true });
module.exports = mongoose.model('TrustVote', trustVoteSchema); 