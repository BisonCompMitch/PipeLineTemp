import React, { useEffect, useMemo, useRef, useState } from 'react';
import ModalPortal from './ModalPortal.jsx';

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
  const targetRef = useRef(null);
  const targetClickHandlerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
  }, [open, normalizedSteps.length]);

  const maxIndex = Math.max(0, normalizedSteps.length - 1);
  const currentIndex = Math.min(index, maxIndex);
  const step = normalizedSteps[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === maxIndex;
  const requiresAction = Boolean(step?.requiredAction && step?.targetSelector);
  const actionEvent = step?.actionEvent === 'dblclick' ? 'dblclick' : 'click';

  useEffect(() => {
    setActionCompleted(false);
    setTargetReady(false);
    setHighlightRect(null);
  }, [open, currentIndex]);

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
          target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
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
  }, [open, requiresAction, step?.targetSelector, actionCompleted, actionEvent]);

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

        <div className="modal tutorial-modal">
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
              <button className="primary" type="button" onClick={handleNext} disabled={requiresAction}>
                {isLast ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
