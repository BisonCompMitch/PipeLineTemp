import React, { useEffect, useMemo, useRef, useState } from 'react';
import ModalPortal from './ModalPortal.jsx';

function intersectsRect(a, b) {
  if (!a || !b) return false;
  return !(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function TutorialDialog({
  open,
  title = 'Quick tour',
  steps = [],
  dontShowAgain = false,
  onDontShowAgainChange,
  onClose
}) {
  const normalizedSteps = useMemo(() => {
    if (Array.isArray(steps) && steps.length) return steps;
    return [
      {
        id: 'welcome',
        title: 'Welcome',
        description: 'Use the navigation to open each workspace and manage your projects.'
      }
    ];
  }, [steps]);

  const [index, setIndex] = useState(0);
  const [targetReady, setTargetReady] = useState(false);
  const [highlightRect, setHighlightRect] = useState(null);
  const [actionCompleted, setActionCompleted] = useState(false);
  const [modalStyle, setModalStyle] = useState({});
  const [viewportMode, setViewportMode] = useState('desktop');
  const targetRef = useRef(null);
  const targetClickHandlerRef = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
  }, [open, normalizedSteps.length]);

  const maxIndex = Math.max(0, normalizedSteps.length - 1);
  const currentIndex = Math.min(index, maxIndex);
  const step = normalizedSteps[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === maxIndex;
  const requiresAction = Boolean(step?.requiredAction);
  const actionEvent = step?.actionEvent === 'dblclick' ? 'dblclick' : 'click';
  const isMobileViewport = viewportMode === 'mobile';
  const isCompactViewport = viewportMode !== 'desktop';

  useEffect(() => {
    if (!open) return;
    const syncViewportMode = () => {
      const width = window.innerWidth || 0;
      if (width <= 700) {
        setViewportMode('mobile');
        return;
      }
      if (width <= 1024) {
        setViewportMode('tablet');
        return;
      }
      setViewportMode('desktop');
    };

    syncViewportMode();
    window.addEventListener('resize', syncViewportMode);
    return () => {
      window.removeEventListener('resize', syncViewportMode);
    };
  }, [open]);

  useEffect(() => {
    setActionCompleted(false);
    setTargetReady(false);
    setHighlightRect(null);
    setModalStyle({});
  }, [open, currentIndex]);

  useEffect(() => {
    if (!open) {
      setModalStyle({});
      return;
    }
    const applyPlacement = () => {
      const horizontalMargin = isCompactViewport ? 10 : 20;
      const verticalMargin = isCompactViewport ? 10 : 20;
      const viewportWidth = Math.max(window.innerWidth, 320);
      const viewportHeight = Math.max(window.innerHeight, 320);
      const element = modalRef.current;
      const maxModalWidth = Math.max(280, viewportWidth - horizontalMargin * 2);
      const maxModalHeight = Math.max(220, viewportHeight - verticalMargin * 2);
      const modalWidth = Math.min(
        element?.offsetWidth || (isCompactViewport ? maxModalWidth : 700),
        maxModalWidth
      );
      const modalHeight = Math.min(
        element?.offsetHeight || (isCompactViewport ? 380 : 360),
        maxModalHeight
      );

      let top = (viewportHeight - modalHeight) / 2;
      let left = (viewportWidth - modalWidth) / 2;

      if (requiresAction && highlightRect) {
        const spacing = 10;
        const spaceAbove = highlightRect.top - verticalMargin;
        const spaceBelow = viewportHeight - (highlightRect.top + highlightRect.height) - verticalMargin;
        if (spaceBelow >= modalHeight + spacing) {
          top = highlightRect.top + highlightRect.height + spacing;
        } else if (spaceAbove >= modalHeight + spacing) {
          top = highlightRect.top - modalHeight - spacing;
        } else if (spaceBelow >= spaceAbove) {
          top = highlightRect.top + highlightRect.height + spacing;
        } else {
          top = highlightRect.top - modalHeight - spacing;
        }
        if (isMobileViewport) {
          left = horizontalMargin;
        } else {
          const targetCenterX = highlightRect.left + highlightRect.width / 2;
          left = targetCenterX - modalWidth / 2;
        }
        const positionedRect = { top, left, width: modalWidth, height: modalHeight };
        if (intersectsRect(positionedRect, highlightRect)) {
          top = viewportHeight - modalHeight - verticalMargin;
        }
      } else if (isMobileViewport) {
        top = viewportHeight - modalHeight - verticalMargin;
        left = (viewportWidth - modalWidth) / 2;
      }

      const maxTop = Math.max(verticalMargin, viewportHeight - modalHeight - verticalMargin);
      const maxLeft = Math.max(horizontalMargin, viewportWidth - modalWidth - horizontalMargin);
      top = clamp(top, verticalMargin, maxTop);
      left = clamp(left, horizontalMargin, maxLeft);
      setModalStyle({
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
        width: `${Math.round(modalWidth)}px`,
        maxHeight: `${Math.round(maxModalHeight)}px`,
      });
    };

    applyPlacement();
    const rafId = window.requestAnimationFrame(applyPlacement);
    window.addEventListener('resize', applyPlacement);
    window.addEventListener('scroll', applyPlacement, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', applyPlacement);
      window.removeEventListener('scroll', applyPlacement, true);
    };
  }, [open, requiresAction, highlightRect, currentIndex, isCompactViewport]);

  useEffect(() => {
    if (!open || !requiresAction) return;
    if (!actionCompleted) return;
    const timer = window.setTimeout(() => {
      if (isLast) {
        onClose?.();
        return;
      }
      setIndex((value) => Math.min(value + 1, maxIndex));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, requiresAction, actionCompleted, isLast, maxIndex, onClose]);

  useEffect(() => {
    if (!open || !requiresAction) return undefined;
    let disposed = false;
    let intervalId = null;

    const removeTargetState = () => {
      const existing = targetRef.current;
      if (existing) {
        existing.classList.remove('tutorial-target-active');
        if (targetClickHandlerRef.current) {
          existing.removeEventListener(actionEvent, targetClickHandlerRef.current, true);
        }
      }
      targetRef.current = null;
      targetClickHandlerRef.current = null;
    };

    const syncHighlight = () => {
      if (disposed) return;
      const selector = String(step.targetSelector || '').trim();
      if (!selector) return;
      const target = document.querySelector(selector);

      if (!target) {
        removeTargetState();
        setTargetReady(false);
        setHighlightRect(null);
        return;
      }

      if (targetRef.current !== target) {
        removeTargetState();
        targetRef.current = target;
        target.classList.add('tutorial-target-active');
        targetClickHandlerRef.current = () => {
          setActionCompleted(true);
        };
        target.addEventListener(actionEvent, targetClickHandlerRef.current, true);

        if (!actionCompleted) {
          target.scrollIntoView({
            block: viewportMode === 'desktop' ? 'center' : 'start',
            inline: 'nearest',
            behavior: 'smooth',
          });
        }
      }

      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setTargetReady(false);
        setHighlightRect(null);
        return;
      }
      const padding = 6;
      const top = Math.max(0, rect.top - padding);
      const left = Math.max(0, rect.left - padding);
      const width = Math.min(window.innerWidth - left, rect.width + padding * 2);
      const height = Math.min(window.innerHeight - top, rect.height + padding * 2);
      setTargetReady(true);
      setHighlightRect({ top, left, width, height });
    };

    syncHighlight();
    intervalId = window.setInterval(syncHighlight, 220);
    window.addEventListener('resize', syncHighlight);
    window.addEventListener('scroll', syncHighlight, true);

    return () => {
      disposed = true;
      if (intervalId) window.clearInterval(intervalId);
      window.removeEventListener('resize', syncHighlight);
      window.removeEventListener('scroll', syncHighlight, true);
      removeTargetState();
    };
  }, [open, requiresAction, step?.targetSelector, actionCompleted, actionEvent, viewportMode]);

  if (!open) return null;

  const handleNext = () => {
    if (requiresAction) return;
    if (isLast) {
      onClose?.();
      return;
    }
    setIndex((value) => Math.min(value + 1, maxIndex));
  };

  return (
    <ModalPortal>
      <div className="tutorial-layer" aria-live="polite">
        {!highlightRect ? <div className="tutorial-screen-dim" /> : null}
        {highlightRect ? (
          <div
            className="tutorial-highlight"
            style={{
              top: `${highlightRect.top}px`,
              left: `${highlightRect.left}px`,
              width: `${highlightRect.width}px`,
              height: `${highlightRect.height}px`
            }}
          />
        ) : null}

        <div
          ref={modalRef}
          className={`modal tutorial-modal tutorial-modal-${viewportMode}`}
          style={modalStyle}
        >
          <div className="modal-header">
            <div>
              <div className="modal-title">{title}</div>
              <div className="tutorial-step-counter">
                Step {currentIndex + 1} of {normalizedSteps.length}
              </div>
            </div>
            <button className="ghost" type="button" onClick={() => onClose?.()}>
              Close
            </button>
          </div>

          <div className="tutorial-body">
            <h3 className="tutorial-step-title">{step.title}</h3>
            <p className="tutorial-step-text">{step.description}</p>
            {requiresAction ? (
              <p className="tutorial-step-hint">
                {targetReady
                  ? actionEvent === 'dblclick'
                    ? 'Double-click the highlighted control to continue.'
                    : 'Click the highlighted control to continue.'
                  : 'Waiting for that control to appear. If needed, open the menu first.'}
              </p>
            ) : null}
          </div>

          <div className="tutorial-footer">
            <label className="tutorial-checkbox">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(event) => onDontShowAgainChange?.(event.target.checked)}
              />
              <span>Don&apos;t show again</span>
            </label>
            <div className="actions tutorial-actions">
              <button
                className="ghost"
                type="button"
                disabled={isFirst}
                onClick={() => setIndex((value) => Math.max(value - 1, 0))}
              >
                Back
              </button>
              {requiresAction ? (
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    if (isLast) {
                      onClose?.();
                      return;
                    }
                    setIndex((value) => Math.min(value + 1, maxIndex));
                  }}
                >
                  Skip
                </button>
              ) : null}
              {!requiresAction ? (
                <button className="primary" type="button" onClick={handleNext}>
                  {isLast ? 'Done' : 'Next'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
