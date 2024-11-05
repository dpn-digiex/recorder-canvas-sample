import { useEffect, useMemo, useRef, useState } from "react";
import { TYPE_ANIMATING } from "@constants";
import { useSpring, useSpringRef } from "@react-spring/konva";
import {
  getConfigGroupInRaw,
  getConfigGroupOutRaw,
  getDefaultAnimationGroupProps,
} from "@utils/animation/groupUtils";
import { toJS } from "mobx";

import {
  ANIMATION_ANIMATE,
  ANIMATION_ID,
  ANIMATION_MODE,
  CANVAS_MODE,
} from "../../components/canvasEditor/styleOptions";

const useGroupAnimation = (
  elementId,
  elementIndex,
  elementRef,
  elementAnimation,
  pageId,
  animationStore,
  canvasMode
) => {
  const {
    playAnimationPage,
    typeAnimating,
    forcedResetAnimation,
    forcedResetAnimationAll,
    tempAnimation,
    modePreview,
    elementAnimationFocus: elementActive,
    pageAnimationActive: pageActive,
  } = animationStore;
  const [animating, setAnimating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [finished, setFinished] = useState(false);
  const [, setPaused] = useState(false);

  const defaultProps = useMemo(
    () => getDefaultAnimationGroupProps(elementRef),
    [elementRef]
  );

  const playingRef = useRef(false);
  const springRef = useSpringRef(null);
  const [animationProps, api] = useSpring(() => ({
    ref: springRef,
    from: defaultProps,
    to: defaultProps,
    reset: true,
  }));

  const listenWaitingToPlay = useMemo(() => {
    return (
      canvasMode === CANVAS_MODE.EXPORTER &&
      elementAnimation?.animationId !== ANIMATION_ID.NONE &&
      ANIMATION_ANIMATE.ENTER_BOTH.includes(elementAnimation?.animate)
    );
  }, [canvasMode, elementAnimation?.animationId, elementAnimation?.animate]);

  useEffect(() => {
    const focusPage = toJS(pageActive?.id) === pageId;
    const triggerWhen = forcedResetAnimation || !playAnimationPage;
    if ((triggerWhen && focusPage) || forcedResetAnimationAll) {
      resetAnimating();
    }
  }, [
    playAnimationPage,
    forcedResetAnimation,
    forcedResetAnimationAll,
    pageActive?.id,
  ]);

  const timeoutPreviewRef = useRef(null);
  // trigger run preview animation
  useEffect(() => {
    if (elementRef?.insideGroupBox) return;
    if (
      modePreview &&
      !playAnimationPage &&
      toJS(pageActive?.id) === pageId &&
      tempAnimation.property?.animationId &&
      tempAnimation.property?.animationId !== ANIMATION_ID.NONE
    ) {
      if (timeoutPreviewRef.current) {
        clearTimeout(timeoutPreviewRef.current);
      }
      timeoutPreviewRef.current = setTimeout(() => {
        // run preview animation for whole page
        if (tempAnimation.mode === ANIMATION_MODE.PAGE) {
          handlePreviewAnimationPage(tempAnimation.property);
        } else if (tempAnimation.mode === ANIMATION_MODE.ELEMENT) {
          if (elementActive?.id === elementId) {
            playAnimationIn({ ...tempAnimation.property, delay: 0 });
          }
        }
        timeoutPreviewRef.current = null;
      }, 200);
      return () => {
        if (timeoutPreviewRef.current) {
          clearTimeout(timeoutPreviewRef.current);
          timeoutPreviewRef.current = null;
        }
        resetAnimating();
      };
    }
  }, [tempAnimation, modePreview]);

  useEffect(() => {
    if (toJS(pageActive?.id) === pageId && playAnimationPage) {
      if (typeAnimating === TYPE_ANIMATING.DEFAULT) return;
      handlePlayAnimationPage(typeAnimating);
    }
  }, [playAnimationPage, typeAnimating]);

  const waitingToPlay = useRef(listenWaitingToPlay ?? true);
  useEffect(() => {
    if (playAnimationPage && waitingToPlay.current && animating) {
      waitingToPlay.current = false;
    }
  }, [animating, playAnimationPage]);

  const handlePlayAnimationPage = type => {
    if (
      elementAnimation?.id === elementId &&
      elementAnimation?.animationId !== ANIMATION_ID.NONE
    ) {
      if (
        type === TYPE_ANIMATING.IN &&
        ANIMATION_ANIMATE.ENTER_BOTH.includes(elementAnimation?.animate)
      ) {
        playAnimationIn(elementAnimation);
      } else if (
        type === TYPE_ANIMATING.OUT &&
        ANIMATION_ANIMATE.EXIT_BOTH.includes(elementAnimation?.animate)
      ) {
        playAnimationOut(elementAnimation);
      } else return;
    }
  };

  const handlePreviewAnimationPage = (properties = {}) => {
    playAnimationIn({
      ...elementAnimation,
      ...properties,
      delay: elementIndex * 200,
    });
  };

  const playAnimationIn = properties => {
    playingRef.current = true;
    setPreparing(true);
    return new Promise(resolve => {
      api.start({
        ...getConfigGroupInRaw(
          properties.animationId,
          defaultProps,
          properties
        ),
        delay: properties.delay || 0,
        reset: true,
        onStart: () => {
          if (playingRef.current) {
            setPreparing(false);
            setAnimating(true);
          }
        },
        onRest: () => {
          if (playingRef.current) {
            setPreparing(false);
            setAnimating(false);
          }
          resolve();
        },
      });
    });
  };

  const playAnimationOut = properties => {
    playingRef.current = true;
    return new Promise(resolve => {
      api.start({
        ...getConfigGroupOutRaw(
          properties.animationId,
          defaultProps,
          properties
        ),
        delay: properties.delay || 0,
        reset: true,
        onStart: () => {
          if (playingRef.current) {
            setAnimating(true);
          }
        },
        onRest: () => {
          if (animating && playingRef.current) {
            setAnimating(false);
            setFinished(true);
          }
          resolve();
        },
      });
    });
  };

  const pauseAnimation = () => {
    setPaused(true);
    api.pause();
  };

  const resumeAnimation = () => {
    setPaused(false);
    api.resume();
  };

  const resetAnimation = (props = {}) => {
    api.stop();
    api.start({
      ...defaultProps,
      ...props,
      offsetX: 0,
      offsetY: 0,
      immediate: true,
    });
  };

  const resetAnimating = () => {
    setAnimating(false);
    setPreparing(false);
    setFinished(false);
    resetAnimation();
    playingRef.current = false;
  };

  return {
    animation: {
      props: animationProps,
      animating: animating,
      preparing: preparing && !animating,
      finished: finished && !animating,
      waitingToPlay: waitingToPlay.current,
    },
    animationFunc: {
      pause: pauseAnimation,
      resume: resumeAnimation,
      reset: resetAnimation,
    },
  };
};

export default useGroupAnimation;
