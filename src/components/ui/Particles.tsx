import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  radius: number
  opacity: number
  speedY: number
  angle: number
  angleSpeed: number
  amplitude: number
}

function createParticle(canvasWidth: number, canvasHeight: number): Particle {
  return {
    x: Math.random() * canvasWidth,
    y: Math.random() * canvasHeight,
    radius: 0.8 + Math.random() * 1.7,
    opacity: 0.15 + Math.random() * 0.25,
    speedY: 0.2 + Math.random() * 0.6,
    angle: Math.random() * Math.PI * 2,
    angleSpeed: 0.005 + Math.random() * 0.015,
    amplitude: 0.3 + Math.random() * 0.5,
  }
}

export default function Particles() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    resize()
    window.addEventListener('resize', resize)

    const COUNT = 50
    const particles: Particle[] = Array.from({ length: COUNT }, () =>
      createParticle(canvas.width, canvas.height),
    )

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (const p of particles) {
        p.angle += p.angleSpeed
        p.x += Math.sin(p.angle) * p.amplitude
        p.y += p.speedY

        if (p.y > canvas.height + 4) {
          p.y = -4
          p.x = Math.random() * canvas.width
          p.angle = Math.random() * Math.PI * 2
        }

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`
        ctx.fill()
      }

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
