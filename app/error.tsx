"use client"

import { useEffect } from "react"

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
	useEffect(() => {
		console.error(error)
	}, [error])

	return (
		<html>
			<body>
				<div style={{ padding: 40, fontFamily: 'Inter, system-ui, sans-serif' }}>
					<h1 style={{ color: '#dc2626' }}>Something went wrong</h1>
					<pre style={{ whiteSpace: 'pre-wrap' }}>{error?.message}</pre>
					<div style={{ marginTop: 20 }}>
						<button onClick={() => reset()} style={{ padding: '8px 12px', background: '#059669', color: 'white', borderRadius: 6 }}>Try again</button>
					</div>
				</div>
			</body>
		</html>
	)
}

