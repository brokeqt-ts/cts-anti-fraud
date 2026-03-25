/**
 * Animated UI components — not in original spec.
 *
 * Framer Motion-based animation primitives used throughout the dashboard
 * for polished transitions: fade-in with blur, number tickers, staggered
 * list reveals, shimmer borders, pulsing status dots, and page transitions.
 * Provides consistent motion design language across all dashboard pages.
 *
 * @module animations
 */
import { useEffect, useState, type ReactNode } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

const EASE = [0.25, 0.4, 0.25, 1] as const;

/* ── BlurFade ────────────────────────────────────────── */

interface BlurFadeProps {
  children: ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
}

export function BlurFade({ children, delay = 0, duration = 0.4, className = '' }: BlurFadeProps) {
  return (
    <motion.div
      initial={{ opacity: 0, filter: 'blur(8px)', y: 8 }}
      animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
      transition={{ delay, duration, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ── NumberTicker ─────────────────────────────────────── */

interface NumberTickerProps {
  value: number;
  delay?: number;
  className?: string;
}

export function NumberTicker({ value, delay = 0, className = '' }: NumberTickerProps) {
  const spring = useSpring(0, { duration: 1200, bounce: 0 });
  const display = useTransform(spring, (v) => Math.round(v));
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => spring.set(value), delay * 1000);
    return () => clearTimeout(timeout);
  }, [value, delay, spring]);

  useEffect(() => {
    return display.on('change', (v) => setDisplayValue(v));
  }, [display]);

  return <span className={className}>{displayValue}</span>;
}

/* ── StaggerContainer + StaggerItem ──────────────────── */

interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
  as?: 'div' | 'tbody';
}

const staggerVariants = (delay: number) => ({
  hidden: {},
  visible: { transition: { staggerChildren: delay } },
});

export function StaggerContainer({ children, className = '', staggerDelay = 0.06, as = 'div' }: StaggerContainerProps) {
  const Tag = as === 'tbody' ? motion.tbody : motion.div;
  return (
    <Tag
      initial="hidden"
      animate="visible"
      variants={staggerVariants(staggerDelay)}
      className={className}
    >
      {children}
    </Tag>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
}

export function StaggerItem({ children, className = '' }: StaggerItemProps) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
        visible: {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          transition: { duration: 0.35, ease: EASE },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ── ShimmerBorder ────────────────────────────────────── */

interface ShimmerBorderProps {
  children: ReactNode;
  className?: string;
  color?: string;
}

export function ShimmerBorder({ children, className = '', color = 'var(--accent-green)' }: ShimmerBorderProps) {
  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`}>
      <motion.div
        className="absolute inset-0 rounded-2xl"
        style={{
          background: `conic-gradient(from 0deg, transparent, color-mix(in srgb, ${color} 25%, transparent), transparent, transparent)`,
          opacity: 0.6,
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
      />
      <div className="relative m-[1px] rounded-2xl" style={{ background: 'var(--bg-base)' }}>
        {children}
      </div>
    </div>
  );
}

/* ── GlowDot ──────────────────────────────────────────── */

interface GlowDotProps {
  color?: string;
  size?: number;
}

export function GlowDot({ color = 'var(--accent-green)', size = 6 }: GlowDotProps) {
  return (
    <span className="relative inline-block" style={{ width: size, height: size }}>
      <span
        className="absolute rounded-full"
        style={{
          inset: -2,
          background: color,
          opacity: 0.3,
          filter: 'blur(3px)',
        }}
      />
      <motion.span
        className="relative block rounded-full"
        style={{ width: size, height: size, background: color }}
        animate={{ opacity: [1, 0.6, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </span>
  );
}

/* ── DotPattern ───────────────────────────────────────── */

export function DotPattern({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`absolute inset-0 h-full w-full ${className}`}
      style={{ maskImage: 'radial-gradient(300px circle at center, white, transparent)' }}
    >
      <defs>
        <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.5" fill="var(--border-medium)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dots)" />
    </svg>
  );
}

/* ── PageTransition ───────────────────────────────────── */

export function PageTransition({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ── AnimatedRow (for table rows with hover scale) ────── */

export function AnimatedRow({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <motion.tr
      variants={{
        hidden: { opacity: 0, y: 8, filter: 'blur(4px)' },
        visible: {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          transition: { duration: 0.3, ease: EASE },
        },
      }}
      whileHover={{
        backgroundColor: 'var(--bg-card)',
        scale: 1.005,
        transition: { duration: 0.15 },
      }}
      className={className}
      onClick={onClick}
      style={{ borderBottom: '1px solid var(--bg-card)', transformOrigin: 'center' }}
    >
      {children}
    </motion.tr>
  );
}
