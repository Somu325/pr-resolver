const express = require('express')
const cors = require('cors')
require('dotenv').config()
const axios = require('axios')
const { GoogleGenerativeAI } = require('@google/generative-ai')




const app = express()
const PORT = process.env.PORT

app.use(cors())
app.use(express.json())

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

  // for now, redirect back to frontend with token in URL
  // (we'll improve this to use cookies/sessions shortly)
  res.redirect(`http://localhost:5173?token=${accessToken}`)
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
})