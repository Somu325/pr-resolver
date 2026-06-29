import { useState } from 'react'

function App() {
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [prNumber, setPrNumber] = useState('')
  const [comments, setComments] = useState([])
  const [suggestions, setSuggestions] = useState({})



  const fetchComments = async () => {
    const response = await fetch(
      `http://localhost:8000/pr-comments?owner=${owner}&repo=${repo}&prNumber=${prNumber}`
    )
    const data = await response.json()
    setComments(data)
    console.log(data)
  }


  const resolveComment = async (comment) => {
    const response = await fetch('http://localhost:8000/resolve-comment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        body: comment.body,
        path: comment.path,
        line: comment.line,
        diff_hunk: comment.diff_hunk
      })
    })

    const data = await response.json()
    setSuggestions((prev) => ({
      ...prev,
      [comment.id]: data.suggestion
    }))
  }

  return (
    <div>
      <h1>PR Comment Resolver</h1>

      <input placeholder="Owner" onChange={(e) => setOwner(e.target.value)} />
      <input placeholder="Repo" onChange={(e) => setRepo(e.target.value)} />
      <input placeholder="PR Number" onChange={(e) => setPrNumber(e.target.value)} />

      <button onClick={fetchComments}>Fetch Comments</button>

      {comments.map((comment) => (
        <div key={comment.id}>
            <p><strong>File:</strong> {comment.path}</p>
            <p><strong>Line:</strong> {comment.line}</p>
            <p><strong>Comment:</strong> {comment.body}</p>
            <button onClick={() => resolveComment(comment)}>Resolve with AI</button>
            {suggestions[comment.id] && (
              <div>
                <strong>AI Suggestion:</strong>
                <p>{suggestions[comment.id]}</p>
              </div>
            )}
            <hr />
        </div>
      ))}

    </div>
  )
}

export default App