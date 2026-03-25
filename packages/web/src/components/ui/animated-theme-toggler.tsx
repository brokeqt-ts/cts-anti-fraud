import { useCallback, useEffect, useRef, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { flushSync } from "react-dom"

interface AnimatedThemeTogglerProps extends React.ComponentPropsWithoutRef<"button"> {
  duration?: number
}

export const AnimatedThemeToggler = ({
  className,
  duration = 400,
  ...props
}: AnimatedThemeTogglerProps) => {
  const [isDark, setIsDark] = useState(true)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem("cts_theme")
    const dark = saved !== "light"
    setIsDark(dark)
    if (!dark) {
      document.documentElement.setAttribute("data-theme", "light")
    }
  }, [])

  const toggleTheme = useCallback(async () => {
    if (!buttonRef.current) return

    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
    const supportsViewTransition = typeof doc.startViewTransition === 'function'

    const doToggle = () => {
      const newDark = !isDark
      setIsDark(newDark)
      if (newDark) {
        document.documentElement.removeAttribute("data-theme")
      } else {
        document.documentElement.setAttribute("data-theme", "light")
      }
      localStorage.setItem("cts_theme", newDark ? "dark" : "light")
    }

    if (supportsViewTransition) {
      const transition = doc.startViewTransition!(() => {
        flushSync(doToggle)
      })

      await transition.ready

      const { top, left, width, height } = buttonRef.current.getBoundingClientRect()
      const x = left + width / 2
      const y = top + height / 2
      const maxRadius = Math.hypot(
        Math.max(left, window.innerWidth - left),
        Math.max(top, window.innerHeight - top)
      )

      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${maxRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        }
      )
    } else {
      doToggle()
    }
  }, [isDark, duration])

  return (
    <button
      ref={buttonRef}
      onClick={toggleTheme}
      className={className}
      style={{
        background: 'none',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: '6px',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'color 0.2s, border-color 0.2s',
      }}
      {...props}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
