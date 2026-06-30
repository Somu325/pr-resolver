const express = require('express')
const cors = require('cors')
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
const axios = require('axios')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const mongoose = require('mongoose')
const { User, WatchedRepo, Suggestion } = require('./models')

const app = express()
const PORT = process.env.PORT || 8000

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pr-resolver')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err))

const crypto = require('crypto')

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012' // Must be 32 bytes
const IV_LENGTH = 16

function encrypt(text) {
  if (!text) return text
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)
  let encrypted = cipher.update(text)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

function decrypt(text) {
  if (!text) return text
  const textParts = text.split(':')
  const iv = Buffer.from(textParts.shift(), 'hex')
  const encryptedText = Buffer.from(textParts.join(':'), 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)
  let decrypted = decipher.update(encryptedText)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  return decrypted.toString()
}

// Rate Limiting configuration
const geminiCallsTrack = {}
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX_CALLS = 100 // 100 calls per hour

function checkRateLimit(userLogin) {
  const now = Date.now()
  if (!geminiCallsTrack[userLogin]) {
    geminiCallsTrack[userLogin] = []
  }
  geminiCallsTrack[userLogin] = geminiCallsTrack[userLogin].filter(t => now - t < RATE_LIMIT_WINDOW_MS)
  if (geminiCallsTrack[userLogin].length >= RATE_LIMIT_MAX_CALLS) {
    return false
  }
  geminiCallsTrack[userLogin].push(now)
  return true
}

app.use(cors())
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf
  }
}))

app.get('/', (req, res) => {
    res.send('PR Resolver server is running!')
})



app.get('/pr-comments', async (req, res) => {
    const owner = req.query.owner
    const repo = req.query.repo
    const prNumber = req.query.prNumber

    const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
        {
            headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`
            }
        }
    )

    res.json(response.data)
})


app.post('/resolve-comment', async (req, res) => {
    const { body, path, line, diff_hunk } = req.body

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const prompt = `
    You are a code reviewer assistant.
    A developer left this comment on a pull request:
    
    Comment: "${body}"
    File: ${path}
    Line: ${line}
    Code:
    ${diff_hunk}
    
    Suggest a fix for this comment in simple terms.
  `

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    res.json({ suggestion: text })
})


app.get('/auth/github', (req, res) => {
  const redirectUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=repo`
  res.redirect(redirectUrl)
})

// Step 2: GitHub redirects back here with a `code`
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code

  try {
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      },
      {
        headers: { Accept: 'application/json' }
      }
    )

    const accessToken = tokenResponse.data.access_token

    if (!accessToken) {
      return res.status(400).send('OAuth exchange failed: no access token returned')
    }

    // Fetch user details from GitHub to persist in MongoDB
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `token ${accessToken}`
      }
    })

    const githubUser = userResponse.data

    // Upsert User in database with encrypted token
    await User.findOneAndUpdate(
      { githubId: String(githubUser.id) },
      {
        githubLogin: githubUser.login,
        accessToken: encrypt(accessToken)
      },
      { upsert: true, new: true }
    )

    // Redirect back to frontend with token in URL
    res.redirect(`http://localhost:5173?token=${accessToken}`)
  } catch (error) {
    console.error('OAuth Callback Error:', error.message)
    res.status(500).send('Authentication failed')
  }
})


app.get('/repos', async (req, res) => {
  const userToken = req.headers.authorization

  const response = await axios.get('https://api.github.com/user/repos', {
    headers: {
      Authorization: userToken
    }
  })

  res.json(response.data)
})

// list open PRs for a given repo
app.get('/repos/:owner/:repo/pulls', async (req, res) => {
  const userToken = req.headers.authorization
  const { owner, repo } = req.params

  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      headers: {
        Authorization: userToken
      }
    }
  )

  res.json(response.data)
})

async function getAuthenticatedUser(userToken) {
  if (!userToken) return null
  const tokenString = userToken.replace('Bearer ', '')
  try {
    const response = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `token ${tokenString}` }
    })
    const githubUser = response.data
    const user = await User.findOne({ githubId: String(githubUser.id) })
    return user
  } catch (err) {
    console.error('getAuthenticatedUser error:', err.message)
    return null
  }
}

app.get('/repos/watched', async (req, res) => {
  const userToken = req.headers.authorization
  if (!userToken) {
    return res.status(401).json({ error: 'Authorization token required' })
  }
  try {
    const user = await getAuthenticatedUser(userToken)
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const watched = await WatchedRepo.find({ userId: user._id })
    res.json(watched)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/repos/:owner/:repo/watch', async (req, res) => {
  const { owner, repo } = req.params
  const userToken = req.headers.authorization
  if (!userToken) {
    return res.status(401).json({ error: 'Authorization token required' })
  }

  try {
    const user = await getAuthenticatedUser(userToken)
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const existing = await WatchedRepo.findOne({ userId: user._id, owner, repo })
    if (existing) {
      return res.status(400).json({ error: 'Repository is already watched' })
    }

    const webhookUrl = process.env.WEBHOOK_URL || 'http://localhost:8000/webhook'
    const webhookSecret = process.env.WEBHOOK_SECRET || 'supersecret'

    const tokenString = userToken.replace('Bearer ', '')

    let hookResponse
    try {
      hookResponse = await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/hooks`,
        {
          name: 'web',
          active: true,
          events: ['pull_request_review_comment'],
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret: webhookSecret,
            insecure_ssl: '0'
          }
        },
        {
          headers: { Authorization: `Bearer ${tokenString}` }
        }
      )
    } catch (err) {
      console.error(`GitHub webhook creation failed: ${err.message}`)
      return res.status(500).json({ error: `Failed to create webhook on GitHub: ${err.message}` })
    }

    const webhookId = hookResponse.data.id

    const watched = new WatchedRepo({
      userId: user._id,
      owner,
      repo,
      webhookId
    })
    await watched.save()

    res.json({ success: true, watched })
  } catch (error) {
    console.error('Watch repo error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.delete('/repos/:owner/:repo/watch', async (req, res) => {
  const { owner, repo } = req.params
  const userToken = req.headers.authorization
  if (!userToken) {
    return res.status(401).json({ error: 'Authorization token required' })
  }

  try {
    const user = await getAuthenticatedUser(userToken)
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const watched = await WatchedRepo.findOne({ userId: user._id, owner, repo })
    if (!watched) {
      return res.status(404).json({ error: 'Repository not watched' })
    }

    if (watched.webhookId) {
      try {
        await axios.delete(
          `https://api.github.com/repos/${owner}/${repo}/hooks/${watched.webhookId}`,
          {
            headers: { Authorization: `Bearer ${tokenString}` }
          }
        )
      } catch (err) {
        console.error(`Failed to delete webhook from GitHub: ${err.message}. Proceeding to delete from DB.`)
      }
    }

    await WatchedRepo.deleteOne({ _id: watched._id })
    res.json({ success: true })
  } catch (error) {
    console.error('Unwatch repo error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.get('/suggestions', async (req, res) => {
  const { status } = req.query
  try {
    const filter = {}
    if (status) {
      filter.status = status
    }
    const suggestions = await Suggestion.find(filter).sort({ createdAt: -1 })
    res.json(suggestions)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

async function processComment({ commentId, owner, repo, userToken }) {
  // Check if Suggestion already exists in DB (Deduplication)
  const existing = await Suggestion.findOne({ commentId: Number(commentId) })
  if (existing) {
    console.log(`Comment ${commentId} already processed (deduplicated)`)
    return { suggestion: existing, source: 'cache' }
  }

  // Resolve token
  let token = userToken
  if (!token) {
    // Look up WatchedRepo to find a user's token
    const watched = await WatchedRepo.findOne({
      owner: { $regex: new RegExp(`^${owner}$`, 'i') },
      repo: { $regex: new RegExp(`^${repo}$`, 'i') }
    }).populate('userId')

    if (watched && watched.userId && watched.userId.accessToken) {
      token = `Bearer ${decrypt(watched.userId.accessToken)}`
    } else if (process.env.GITHUB_TOKEN) {
      token = `Bearer ${process.env.GITHUB_TOKEN}`
    } else {
      throw new Error(`No GitHub access token found for watched repo ${owner}/${repo}`)
    }
  }

  // Fetch comment detail from GitHub
  const commentResponse = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/pulls/comments/${commentId}`,
    {
      headers: {
        Authorization: token
      }
    }
  )
  const comment = commentResponse.data

  const prNumber = parseInt(comment.pull_request_url.split('/').pop(), 10)

  // Fetch PR detail to get head branch name
  const prResponse = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: token
      }
    }
  )
  const prHeadBranch = prResponse.data.head.ref

  // Fetch target file content at commit_id
  const fileResponse = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${comment.path}?ref=${comment.commit_id}`,
    {
      headers: {
        Authorization: token
      }
    }
  )
  const fileContent = Buffer.from(fileResponse.data.content, 'base64').toString('utf8')

  // Extract context window
  const lines = fileContent.split('\n')
  const commentLine = comment.line || comment.original_line
  const targetLine = commentLine || 1
  const startLine = Math.max(1, targetLine - 15)
  const endLine = Math.min(lines.length, targetLine + 15)

  const contextLines = []
  for (let i = startLine; i <= endLine; i++) {
    contextLines.push(`${i}: ${lines[i - 1]}`)
  }
  const contextBlock = contextLines.join('\n')

  // Generate structured fix using Gemini API
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          startLine: { type: 'INTEGER', nullable: true },
          endLine: { type: 'INTEGER', nullable: true },
          newCode: { type: 'STRING', nullable: true },
          explanation: { type: 'STRING' },
          confidence: { type: 'STRING', enum: ['high', 'low', 'none'] }
        },
        required: ['startLine', 'endLine', 'newCode', 'explanation', 'confidence']
      }
    }
  })

  const prompt = `
You are an expert software developer resolving code review comments on a GitHub Pull Request.
A reviewer left a comment on a file.

File Path: ${comment.path}
Target Line: ${targetLine}
Reviewer Comment: "${comment.body}"

Here is the line-numbered code context around line ${targetLine} (lines ${startLine} to ${endLine}):
\`\`\`
${contextBlock}
\`\`\`

Based on the reviewer's comment, suggest a precise, line-scoped code fix if possible.
Instructions:
1. If the comment requires architectural changes, design changes, multi-file edits, or is ambiguous, set confidence to "none", startLine to null, endLine to null, and newCode to null.
2. If a clean, mechanical line-level fix exists, provide the startLine, endLine, newCode, and set confidence to "high" (or "low" if uncertain).
3. The "startLine" and "endLine" must match the 1-based line numbers in the context provided above.
4. "newCode" must be the exact new code that will replace the lines from "startLine" to "endLine". It must not contain line numbers or markdown formatting.
`

  const result = await model.generateContent(prompt)
  let aiResponse
  try {
    aiResponse = JSON.parse(result.response.text())
  } catch (e) {
    console.error('Failed to parse Gemini JSON response:', result.response.text())
    throw new Error('Gemini did not return valid JSON')
  }

  // Extract original code that AI proposed to replace
  let originalCode = null
  if (aiResponse.startLine && aiResponse.endLine) {
    originalCode = lines.slice(aiResponse.startLine - 1, aiResponse.endLine).join('\n')
  }

  // Persist Suggestion to DB
  const suggestion = new Suggestion({
    owner,
    repo,
    prNumber,
    prHeadBranch,
    commentId: Number(commentId),
    commentBody: comment.body,
    filePath: comment.path,
    commentLine: targetLine,
    startLine: aiResponse.startLine,
    endLine: aiResponse.endLine,
    originalCode,
    suggestedCode: aiResponse.newCode,
    explanation: aiResponse.explanation,
    confidence: aiResponse.confidence,
    status: 'pending'
  })

  await suggestion.save()
  return { suggestion, source: 'generation' }
}

app.post('/debug/process-comment', async (req, res) => {
  const { commentId, owner, repo } = req.body

  if (!commentId || !owner || !repo) {
    return res.status(400).json({ error: 'commentId, owner, and repo are required' })
  }

  try {
    const userToken = req.headers.authorization || (process.env.GITHUB_TOKEN ? `Bearer ${process.env.GITHUB_TOKEN}` : null)

    if (!userToken) {
      return res.status(401).json({ error: 'Authorization header or GITHUB_TOKEN is required' })
    }

    const user = await getAuthenticatedUser(userToken)
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    if (!checkRateLimit(user.githubLogin)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' })
    }

    const result = await processComment({ commentId, owner, repo, userToken })
    res.json(result)
  } catch (error) {
    console.error('Debug process comment error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/webhook', async (req, res) => {
  // 1. Signature Verification
  const sig = req.headers['x-hub-signature-256']
  const secret = process.env.WEBHOOK_SECRET || 'supersecret'
  if (!sig) {
    console.error('Webhook signature missing')
    return res.status(401).send('Signature missing')
  }

  const hmac = crypto.createHmac('sha256', secret)
  const digest = 'sha256=' + hmac.update(req.rawBody || '').digest('hex')
  if (sig !== digest) {
    console.error('Webhook signature mismatch')
    return res.status(401).send('Signature mismatch')
  }

  // 2. Acknowledge webhook immediately (HTTP 200)
  res.status(200).send('Event received')

  const event = req.headers['x-github-event']
  const payload = req.body

  if (event !== 'pull_request_review_comment') {
    return
  }

  if (payload.action !== 'created') {
    return
  }

  const commentId = payload.comment.id
  const owner = payload.repository.owner.login
  const repo = payload.repository.name

  // 3. Rate Limit Check
  if (!checkRateLimit(owner)) {
    console.warn(`Rate limit exceeded for repository owner ${owner}`)
    return
  }

  // 2. Process comment asynchronously
  setImmediate(async () => {
    try {
      console.log(`Asynchronously processing webhook comment ${commentId} for ${owner}/${repo}`)
      await processComment({ commentId, owner, repo })
      console.log(`Successfully processed webhook comment ${commentId}`)
    } catch (err) {
      console.error(`Failed to process webhook comment ${commentId}:`, err.message)
      // Save as a failed suggestion
      try {
        const existing = await Suggestion.findOne({ commentId: Number(commentId) })
        if (!existing) {
          const suggestion = new Suggestion({
            owner,
            repo,
            prNumber: payload.pull_request.number,
            prHeadBranch: payload.pull_request.head.ref,
            commentId: Number(commentId),
            commentBody: payload.comment.body,
            filePath: payload.comment.path,
            commentLine: payload.comment.line || payload.comment.original_line || 1,
            status: 'failed',
            explanation: `Asynchronous processing failed: ${err.message}`,
            // empty fields because of error
            prHeadBranch: payload.pull_request.head.ref
          })
          await suggestion.save()
        }
      } catch (dbErr) {
        console.error('Failed to save error status to suggestion db:', dbErr.message)
      }
    }
  })
})

app.post('/suggestions/:id/approve', async (req, res) => {
  const { id } = req.params
  try {
    const sug = await Suggestion.findById(id)
    if (!sug) {
      return res.status(404).json({ error: 'Suggestion not found' })
    }

    if (sug.status !== 'pending' && sug.status !== 'failed') {
      return res.status(400).json({ error: `Suggestion is already in state: ${sug.status}` })
    }

    // Determine the authorization token
    let userToken = req.headers.authorization
    if (!userToken) {
      // Find token from User collection associated with the suggestion repository
      const watched = await WatchedRepo.findOne({
        owner: { $regex: new RegExp(`^${sug.owner}$`, 'i') },
        repo: { $regex: new RegExp(`^${sug.repo}$`, 'i') }
      }).populate('userId')

      if (watched && watched.userId && watched.userId.accessToken) {
        userToken = `Bearer ${decrypt(watched.userId.accessToken)}`
      } else if (process.env.GITHUB_TOKEN) {
        userToken = `Bearer ${process.env.GITHUB_TOKEN}`
      } else {
        return res.status(401).json({ error: 'Authorization token not found' })
      }
    }

    // 1. Fetch target file content and current SHA from the PR head branch
    const fileUrl = `https://api.github.com/repos/${sug.owner}/${sug.repo}/contents/${sug.filePath}?ref=${sug.prHeadBranch}`
    let fileResponse
    try {
      fileResponse = await axios.get(fileUrl, {
        headers: { Authorization: userToken }
      })
    } catch (err) {
      console.error(`Failed to fetch head file: ${err.message}`)
      return res.status(500).json({ error: `Failed to fetch target file from PR branch: ${err.message}` })
    }

    const currentContent = Buffer.from(fileResponse.data.content, 'base64').toString('utf8')
    const currentSha = fileResponse.data.sha

    // 2. Splice suggested code fix at line ranges
    const lines = currentContent.split('\n')
    const startLine = sug.startLine
    const endLine = sug.endLine

    if (!startLine || !endLine || startLine < 1 || endLine > lines.length || startLine > endLine) {
      return res.status(400).json({ error: `Invalid line replacement range: [${startLine}, ${endLine}] in file of length ${lines.length}` })
    }

    const deleteCount = endLine - startLine + 1
    lines.splice(startLine - 1, deleteCount, sug.suggestedCode)
    const updatedContent = lines.join('\n')

    // 3. Commit updated file content back to GitHub branch
    let commitResponse
    try {
      commitResponse = await axios.put(
        `https://api.github.com/repos/${sug.owner}/${sug.repo}/contents/${sug.filePath}`,
        {
          message: `Resolve PR comment: ${sug.commentBody.slice(0, 50)}...`,
          content: Buffer.from(updatedContent).toString('base64'),
          sha: currentSha,
          branch: sug.prHeadBranch
        },
        {
          headers: { Authorization: userToken }
        }
      )
    } catch (err) {
      console.error(`Failed to commit fix: ${err.message}`)
      return res.status(500).json({ error: `Failed to commit updated file to GitHub: ${err.message}` })
    }

    const commitSha = commitResponse.data.commit.sha

    // 4. Reply to the original comment thread confirming resolution
    try {
      await axios.post(
        `https://api.github.com/repos/${sug.owner}/${sug.repo}/pulls/comments/${sug.commentId}/replies`,
        {
          body: `🤖 PR suggestion approved and applied!\n\nCommit: ${commitSha}\n\n*Applied via PR Comment Resolver Dashboard.*`
        },
        {
          headers: { Authorization: userToken }
        }
      )
    } catch (err) {
      console.error(`Failed to reply to comment thread: ${err.message}. However, commit was applied.`)
      // Do not fail the whole request because the commit was already successfully pushed.
    }

    // 5. Update suggestion status to applied in DB
    sug.status = 'applied'
    sug.resolvedAt = new Date()
    sug.appliedCommitSha = commitSha
    await sug.save()

    res.json({ success: true, commitSha, suggestion: sug })
  } catch (error) {
    console.error('Approve suggestion error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

app.post('/suggestions/:id/reject', async (req, res) => {
  const { id } = req.params
  try {
    const sug = await Suggestion.findById(id)
    if (!sug) {
      return res.status(404).json({ error: 'Suggestion not found' })
    }

    sug.status = 'rejected'
    sug.resolvedAt = new Date()
    await sug.save()

    res.json({ success: true, suggestion: sug })
  } catch (error) {
    console.error('Reject suggestion error:', error.message)
    res.status(500).json({ error: error.message })
  }
})


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
})