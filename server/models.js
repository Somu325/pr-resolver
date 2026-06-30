const mongoose = require('mongoose')

const UserSchema = new mongoose.Schema({
  githubId: { type: String, required: true, unique: true },
  githubLogin: { type: String, required: true },
  accessToken: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
})

const WatchedRepoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  owner: { type: String, required: true },
  repo: { type: String, required: true },
  webhookId: { type: Number },
  createdAt: { type: Date, default: Date.now }
})

// Create compound unique index to prevent duplicate watched repos for the same user
WatchedRepoSchema.index({ userId: 1, owner: 1, repo: 1 }, { unique: true })

const SuggestionSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  repo: { type: String, required: true },
  prNumber: { type: Number, required: true },
  prHeadBranch: { type: String, required: true },
  commentId: { type: Number, required: true, unique: true }, // unique index for deduplication
  commentBody: { type: String, required: true },
  filePath: { type: String, required: true },
  commentLine: { type: Number, required: true },
  startLine: { type: Number },
  endLine: { type: Number },
  originalCode: { type: String },
  suggestedCode: { type: String },
  explanation: { type: String },
  confidence: { type: String, enum: ['high', 'low', 'none'] },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'applied', 'failed'], 
    default: 'pending' 
  },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date },
  appliedCommitSha: { type: String }
})

const User = mongoose.model('User', UserSchema)
const WatchedRepo = mongoose.model('WatchedRepo', WatchedRepoSchema)
const Suggestion = mongoose.model('Suggestion', SuggestionSchema)

module.exports = {
  User,
  WatchedRepo,
  Suggestion
}
