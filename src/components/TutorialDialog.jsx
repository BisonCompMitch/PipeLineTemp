import React, { useEffect, useMemo, useState } from 'react';
import ModalPortal from './ModalPortal.jsx';

export default function TutorialDialog({
  open,
  title = 'Quick tour',
  steps = [],
  dontShowAgain = false,
  onDontShowAgainChange,
  onNavigate,
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

  useEffect(() => {
    if (!open) return;
    setIndex(0);
  }, [open, normalizedSteps.length]);

  if (!open) return null;

  const maxIndex = normalizedSteps.length - 1;
  const currentIndex = Math.min(index, maxIndex);
  const step = normalizedSteps[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === maxIndex;

  const handleNext = () => {
    if (isLast) {
      onClose?.();
      return;
    }
    setIndex((value) => Math.min(value + 1, maxIndex));
  };

  return (
    <ModalPortal>
      <div className="modal-backdrop preview-backdrop tutorial-backdrop" onClick={() => onClose?.()}>
        <div className="modal tutorial-modal" onClick={(event) => event.stopPropagation()}>
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
            {step.route ? (
              <button
                className="ghost tutorial-route-button"
                type="button"
                onClick={() => onNavigate?.(step.route)}
              >
                Open {step.routeLabel || step.title}
              </button>
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
              <button className="primary" type="button" onClick={handleNext}>
                {isLast ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
