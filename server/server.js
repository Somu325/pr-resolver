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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
})