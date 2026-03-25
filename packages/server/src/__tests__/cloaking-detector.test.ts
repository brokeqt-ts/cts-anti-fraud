import { describe, it, expect } from 'vitest';
import { compareContent, detectSuspiciousJS, detectRedirectTags, detectKnownServices } from '../services/cloaking-detector.js';

describe('Cloaking Detector', () => {
  describe('compareContent', () => {
    it('returns 1 for identical content', () => {
      const html = '<html><body><p>Hello world this is a test page</p></body></html>';
      expect(compareContent(html, html)).toBeCloseTo(1, 1);
    });

    it('returns high similarity for minor differences', () => {
      const html1 = '<html><body><p>Hello world this is a test page with content</p></body></html>';
      const html2 = '<html><body><p>Hello world this is a test page with content and extra</p></body></html>';
      expect(compareContent(html1, html2)).toBeGreaterThan(0.7);
    });

    it('returns low similarity for very different content', () => {
      const html1 = '<html><body><p>This is a gambling site with casino games and slots</p></body></html>';
      const html2 = '<html><body><p>Welcome to our healthy cooking recipes and nutrition blog</p></body></html>';
      expect(compareContent(html1, html2)).toBeLessThan(0.5);
    });

    it('handles empty inputs', () => {
      expect(compareContent('', '')).toBe(1);
      expect(compareContent('<p>text</p>', '')).toBe(0);
    });

    it('strips script and style tags before comparison', () => {
      const html1 = '<html><body><script>var x = 1;</script><p>Same content here for testing purposes</p></body></html>';
      const html2 = '<html><body><script>var y = 2;</script><p>Same content here for testing purposes</p></body></html>';
      expect(compareContent(html1, html2)).toBeCloseTo(1, 1);
    });
  });

  describe('detectSuspiciousJS', () => {
    it('detects Googlebot UA check', () => {
      const html = '<script>if(navigator.userAgent.includes("Googlebot")){window.location="/"}</script>';
      const signals = detectSuspiciousJS(html);
      const botCheck = signals.find(s => s.signal === 'js_pattern_ua_check_googlebot');
      expect(botCheck).toBeDefined();
      expect(botCheck!.detected).toBe(true);
    });

    it('detects generic bot check', () => {
      const html = '<script>if(navigator.userAgent.match(/bot|crawl|spider/i)){}</script>';
      const signals = detectSuspiciousJS(html);
      const botCheck = signals.find(s => s.signal === 'js_pattern_ua_check_generic_bot');
      expect(botCheck).toBeDefined();
      expect(botCheck!.detected).toBe(true);
    });

    it('detects obfuscated eval', () => {
      const html = '<script>eval(atob("d2luZG93LmxvY2F0aW9uPSIvIg=="))</script>';
      const signals = detectSuspiciousJS(html);
      const evalCheck = signals.find(s => s.signal === 'js_pattern_obfuscated_eval');
      expect(evalCheck).toBeDefined();
      expect(evalCheck!.detected).toBe(true);
    });

    it('detects referrer check', () => {
      const html = '<script>if(document.referrer.includes("google")){}</script>';
      const signals = detectSuspiciousJS(html);
      const refCheck = signals.find(s => s.signal === 'js_pattern_referrer_check');
      expect(refCheck).toBeDefined();
      expect(refCheck!.detected).toBe(true);
    });

    it('returns false for clean pages', () => {
      const html = '<html><body><script>console.log("hello")</script></body></html>';
      const signals = detectSuspiciousJS(html);
      expect(signals.every(s => !s.detected)).toBe(true);
    });
  });

  describe('detectRedirectTags', () => {
    it('detects meta refresh', () => {
      const html = '<html><head><meta http-equiv="refresh" content="0; url=https://other.com"></head></html>';
      const signals = detectRedirectTags(html);
      expect(signals[0]!.detected).toBe(true);
    });

    it('no detection for normal pages', () => {
      const html = '<html><head><meta charset="utf-8"></head></html>';
      const signals = detectRedirectTags(html);
      expect(signals[0]!.detected).toBe(false);
    });
  });

  describe('detectKnownServices', () => {
    it('detects keitaro reference', () => {
      const html = '<script src="https://keitaro.io/track.js"></script>';
      const signals = detectKnownServices(html);
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.detected).toBe(true);
    });

    it('detects tracker domain', () => {
      const html = '<img src="https://tracker.example.com/pixel.gif">';
      const signals = detectKnownServices(html);
      expect(signals.some(s => s.detected)).toBe(true);
    });

    it('returns empty for clean pages', () => {
      const html = '<html><body><p>Normal page content</p></body></html>';
      const signals = detectKnownServices(html);
      expect(signals.length).toBe(0);
    });
  });
});
