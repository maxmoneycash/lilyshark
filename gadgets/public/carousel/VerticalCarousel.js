// Adapted compiled public preview, not recovered authored source. Motion logic is preserved.
import { useMemo, useRef, useEffect, jsx, jsxs, useMotionValue, useTransform, animate, motion } from './runtime.js';
// The published browser uses the interactive branch. Framer editor canvas mode is omitted.
const useStaticPreview = () => false;
function VerticalCarouselRuntime(e) {
  let t = useStaticPreview(),
    {
      items: r = [],
      spacing: a = 240,
      cardWidth: s = 320,
      cardHeight: c = 400,
      textSpacing: l = 6,
      blurIntensity: u = 60,
      overlayOpacity: f = .6,
      autoPlay: p = !1,
      autoPlaySpeed: h = 3,
      damping: g = 35,
      textFont: _ = {},
      onProgress, onReady, reducedMotion = false, initialProgress = 0,
      style: ee
    } = {
      ...e,
      ...(e.layout || {}),
      ...(e.styling || {}),
      ...(e.behavior || {})
    },
    v = useMemo(() => {
      let items = [...r];
      if (!items.length) return items;
      while (items.length < 7) items = [...items, ...r];
      return items;
    }, [r]),
    y = v.length,
    x = useMotionValue(initialProgress),
    re = useRef(null),
    ie = useRef(null),
    S = (e, t, n) => {
      let r = t - e;
      return y === 1 ? 0 : ((n - e) % r + r) % r + e;
    };
  useEffect(() => {
    const select = () => {
      if (y) onProgress?.(x.get());
    };
    const move = target => {
      if (reducedMotion) x.set(target);
      else animate(x, target, { type: 'spring', stiffness: 250, damping: g, mass: 1 });
    };
    onReady?.({ element: re.current, progress: x, step: delta => move(Math.round(x.get()) + delta), jump: index => move(index) });
    select();
    const stop = x.on('change', select);
    return () => { stop(); x.stop(); onReady?.(null); };
  }, [x, y, g, onProgress, onReady, reducedMotion]);
  useEffect(() => {
    if (t || !p || y === 0) return;
    let e = setInterval(() => {
      let e = Math.round(x.get()) + 1;
      animate(x, e, {
        type: `spring`,
        stiffness: 250,
        damping: g,
        mass: 1
      });
    }, h * 1e3);
    return () => clearInterval(e);
  }, [p, h, x, y, g, t]), useEffect(() => {
    if (t || y < 2) return;
    let e = re.current;
    if (!e) return;
    let n = !1,
      r = 0,
      i = e => {
        if (e.ctrlKey || e.target.closest('button, input, select')) return;
        if (reducedMotion) {
          e.preventDefault();
          if (!n) { x.set(Math.round(x.get()) + Math.sign(e.deltaY)); n = true; }
          clearTimeout(ie.current); ie.current = setTimeout(() => { n = false; }, 150);
          return;
        }
        e.preventDefault(), n || (n = !0, r = x.get()), r += e.deltaY / a, animate(x, r, {
          type: `spring`,
          stiffness: 400,
          damping: 40,
          mass: 1
        }), clearTimeout(ie.current), ie.current = setTimeout(() => {
          n = !1;
          let e = Math.round(x.get());
          animate(x, e, {
            type: `spring`,
            stiffness: 250,
            damping: g,
            mass: 1
          });
        }, 150);
      };
    return e.addEventListener(`wheel`, i, {
      passive: !1
    }), () => {
      e.removeEventListener(`wheel`, i), clearTimeout(ie.current);
    };
  }, [x, a, g, t, y, reducedMotion]);
  let ae = () => {
      x.stop();
    },
    oe = (e, t) => {
      if (!reducedMotion && y > 1) x.set(x.get() - t.delta.y / a);
    },
    se = (e, t) => {
      if (y < 2) return;
      if (reducedMotion) { if (Math.abs(t.offset.y) > 30) x.set(Math.round(x.get()) - Math.sign(t.offset.y)); return; }
      let n = -t.velocity.y / a,
        r = x.get() + n * .15;
      animate(x, Math.round(r), {
        type: `spring`,
        stiffness: 250,
        damping: g,
        mass: 1
      });
    },
    ce = e => {
      let t = x.get(),
        n = Math.round(t),
        r = n + S(-y / 2, y / 2, e - n);
      if (reducedMotion) { x.set(r); return; }
      animate(x, r, {
        type: `spring`,
        stiffness: 250,
        damping: g,
        mass: 1
      });
    };
  return jsxs(`div`, {
    ref: re,
    className: "vertical-carousel",
    "aria-hidden": true,
    style: {
      width: `100%`,
      height: `100%`,
      minWidth: 100,
      minHeight: 100,
      position: `relative`,
      overflow: `hidden`,
      backgroundColor: `#000`,
      display: `flex`,
      alignItems: `center`,
      justifyContent: `center`,
      fontFamily: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
      ..._,
      ...ee
    },
    children: [v.map((e, t) => jsx(BackgroundLayer, {
      index: t,
      image: e.image,
      progress: x,
      N: y,
      blurIntensity: u,
      wrap: S
    }, `bg-${t}`)), v.map((e, t) => jsx(SideTitle, {
      text: e.titleLeft,
      align: `left`,
      index: t,
      progress: x,
      N: y,
      spacing: l,
      wrap: S
    }, `left-text-${t}`)), v.map((e, t) => jsx(SideTitle, {
      text: e.titleRight,
      align: `right`,
      index: t,
      progress: x,
      N: y,
      spacing: l,
      wrap: S
    }, `right-text-${t}`)), jsx(motion.div, {
      style: {
        position: `absolute`,
        width: `100%`,
        height: `100%`,
        zIndex: 10,
        touchAction: `none`
      },
      onPanStart: ae,
      onPan: oe,
      onPanEnd: se,
      children: jsx(`div`, {
        style: {
          position: `absolute`,
          top: `50%`,
          left: `50%`,
          width: 0,
          height: 0
        },
        children: v.map((e, t) => jsx(CarouselCard, {
          index: t,
          item: e,
          progress: x,
          N: y,
          spacing: a,
          cardWidth: s,
          cardHeight: c,
          overlayOpacity: f,
          wrap: S,
          onTap: () => ce(t)
        }, `item-${t}`))
      })
    })]
  });
}
function SideTitle({
  text: e,
  align: t,
  index: n,
  progress: r,
  N: i,
  spacing: a,
  wrap: o
}) {
  let s = useTransform(r, e => {
      let t = o(-i / 2, i / 2, n - e);
      return Math.max(1 - Math.abs(t) * 2, 0);
    }),
    c = useTransform(r, e => o(-i / 2, i / 2, n - e) * 20);
  return e ? jsx(motion.div, {
    "data-carousel-side": `${t}-${n}`,
    style: {
      position: `absolute`,
      top: `50%`,
      y: useTransform(c, e => `calc(-50% + ${e}px)`),
      [t === `left` ? `left` : `right`]: `${a}%`,
      zIndex: 20,
      color: `#ffffff`,
      fontSize: 24,
      fontWeight: 400,
      letterSpacing: `0.02em`,
      pointerEvents: `none`,
      whiteSpace: `nowrap`,
      opacity: s
    },
    children: e
  }) : null;
}
function BackgroundLayer({
  index: e,
  image: t,
  progress: n,
  N: r,
  blurIntensity: i,
  wrap: a
}) {
  let o = useTransform(n, t => {
    let n = a(-r / 2, r / 2, e - t);
    return Math.max(1 - Math.abs(n), 0);
  });
  return jsx(motion.div, {
    "data-carousel-background": e,
    style: {
      position: `absolute`,
      top: -50,
      left: -50,
      right: -50,
      bottom: -50,
      backgroundImage: t ? `url(${t})` : `none`,
      backgroundSize: `cover`,
      backgroundPosition: `center`,
      opacity: o,
      filter: `blur(${i}px) brightness(0.4)`,
      zIndex: 0
    }
  });
}
function CarouselCard({
  index: e,
  item: t,
  progress: n,
  N: r,
  spacing: i,
  cardWidth: a,
  cardHeight: o,
  overlayOpacity: s,
  wrap: c,
  onTap: l
}) {
  let u = useTransform(n, t => c(-r / 2, r / 2, e - t)),
    f = useTransform(u, e => e * i),
    p = useTransform(u, e => Math.max(1 - Math.abs(e) * .25, .5)),
    h = useTransform(u, e => Math.max(1 - Math.abs(e) * .5, 0)),
    g = useTransform(u, e => Math.round(100 - Math.abs(e) * 10)),
    _ = useTransform(u, e => `blur(${Math.abs(e) * 3}px)`);
  return jsx(motion.a, {
    href: t.href,
    draggable: false,
    tabIndex: -1,
    "aria-label": t.centerText,
    className: "vertical-carousel-card",
    "data-carousel-card": t.slug,
    "data-carousel-slot": e,
    onClick: event => {
      // The reference brings a neighboring card to center. Only the centered
      // card opens its page; modifier-click retains native browser behavior.
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
          Math.abs(c(-r / 2, r / 2, e - n.get())) > .1) {
        event.preventDefault();
        l();
      }
    },
    style: {
      textDecoration: `none`,
      color: `inherit`,
      position: `absolute`,
      x: -a / 2,
      y: useTransform(f, e => e - o / 2),
      width: a,
      height: o,
      scale: p,
      opacity: h,
      zIndex: g,
      filter: _,
      borderRadius: 24,
      overflow: `hidden`,
      boxShadow: `0 24px 48px rgba(0,0,0,0.4)`,
      cursor: `pointer`,
      backgroundColor: `#1a1a1a`,
      backgroundImage: t.image ? `url(${t.image})` : `none`,
      backgroundSize: `cover`,
      backgroundPosition: `center`
    },
    children: jsxs(`div`, {
      style: {
        position: `absolute`,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        padding: 28,
        display: `flex`,
        flexDirection: `column`,
        justifyContent: `space-between`,
        color: `#ffffff`,
        background: `linear-gradient(to bottom, rgba(0,0,0,${s}) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,${s}) 100%)`
      },
      children: [jsxs(`div`, {
        children: [jsx(`h3`, {
          style: {
            margin: 0,
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: `-0.02em`
          },
          children: t.centerText
        }), jsx(`p`, {
          "data-carousel-maker": true,
          style: {
            margin: `6px 0 0 0`,
            fontSize: 14,
            opacity: .6,
            fontWeight: 400
          },
          children: t.subText
        })]
      }), jsxs(`div`, {
        style: {
          display: `flex`,
          justifyContent: `space-between`,
          alignItems: `flex-end`
        },
        children: [jsx(`div`, {
          "data-carousel-badge": true,
          style: {
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: `0.1em`,
            padding: `6px 10px`,
            background: `rgba(255,255,255,0.15)`,
            backdropFilter: `blur(10px)`,
            borderRadius: 6
          },
          children: t.badge || "VIEW"
        }), jsx(`div`, {
          "data-carousel-number": true,
          style: {
            fontSize: 56,
            fontWeight: 300,
            lineHeight: .8,
            letterSpacing: `-0.04em`
          },
          children: t.number
        })]
      })]
    })
  });
}
export default VerticalCarouselRuntime;
