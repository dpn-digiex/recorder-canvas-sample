import { useEffect, useMemo, useRef, useState } from "react";
import { TYPE_ANIMATING, TYPE_WRITING } from "@constants";
import { useSpringRef, useSprings } from "@react-spring/konva";
import { getTokensInString } from "@utils";
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

const useTextAnimation = (
  elementId,
  elementIndex,
  elementRef,
  elementAnimation,
  typeWriting,
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
  const [paused, setPaused] = useState(false);

  const defaultProps = useMemo(
    () => getDefaultAnimationGroupProps(elementRef),
    [elementRef]
  );

  const playingRef = useRef(false);
  const springRef = useSpringRef(null);

  const resetAnimation = () => {
    textApi?.stop();
    textApi?.start(index => {
      // console.log("reset with", index, typeWriting);
      return {
        ...elementRef,
        // ...(typeAnimating === TYPE_ANIMATING.IN && { opacity: 0 }),
        offsetX: 0,
        offsetY: 0,
        immediate: true,
      };
    });
  };

  const resetAnimating = () => {
    setAnimating(false);
    setPreparing(false);
    setFinished(false);
    resetAnimation();
    playingRef.current = false;
  };

  const springCount = useMemo(() => {
    resetAnimation();
    switch (typeWriting) {
      case TYPE_WRITING.CHARACTER:
        return defaultProps.text.split("").length;
      case TYPE_WRITING.WORD:
        return getTokensInString(defaultProps.text).length;
      case TYPE_WRITING.ELEMENT:
        return 1;
      default:
        return 1;
    }
  }, [typeWriting]);

  const [animationProps, textApi] = useSprings(springCount, index => {
    return {
      ref: springRef,
      from: { ...defaultProps, offsetX: 0, offsetY: 0 },
      to: { ...defaultProps, offsetX: 0, offsetY: 0 },
      reset: true,
    };
  });

  const listenWaitingToPlay = useMemo(() => {
    return (
      canvasMode === CANVAS_MODE.EXPORTER &&
      elementAnimation?.animationId !== ANIMATION_ID.NONE &&
      ANIMATION_ANIMATE.ENTER_BOTH.includes(elementAnimation?.animate)
    );
  }, [canvasMode, elementAnimation?.animationId, elementAnimation?.animate]);

  useEffect(() => {
    if (
      ((forcedResetAnimation || !playAnimationPage) &&
        toJS(pageActive?.id) === pageId) ||
      forcedResetAnimationAll
    ) {
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
      elementAnimation.id === elementId &&
      elementAnimation.animationId !== ANIMATION_ID.NONE
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
    textApi.set({ opacity: 0 });
    return new Promise(resolve => {
      let animationCount = 0;
      const animationDelay = properties.delay || 0;
      const perTextSpeed = +(properties.speed / springCount).toFixed(1);
      const animationEnterConfig = getConfigGroupInRaw(
        properties.animationId,
        defaultProps,
        {
          ...properties,
          speed: perTextSpeed,
        }
      );
      textApi.start(index => {
        const delayBetweenTexts = index * perTextSpeed;
        return {
          ...animationEnterConfig,
          delay: animationDelay + delayBetweenTexts,
          reset: true,
          onStart: () => {
            if (index === 0 && playingRef.current) {
              setPreparing(false);
              setAnimating(true);
            }
          },
          onRest: () => {
            animationCount++;
            if (animationCount === springCount && playingRef.current) {
              setPreparing(false);
              setAnimating(false);
              // const endTime = performance.now();
              // const elapsedTimeInSeconds = (endTime - startTime) / 1000;
              // console.log(
              //   `Animation finished in ${elapsedTimeInSeconds} seconds`
              // );
            }
            resolve();
          },
        };
      });
      // const startTime = performance.now();
    });
  };

  const playAnimationOut = properties => {
    playingRef.current = true;
    if (typeWriting === TYPE_WRITING.WORD) {
      textApi.set({ y: 0 });
    }
    return new Promise(resolve => {
      let animationCount = 0;
      const animationDelay = properties.delay || 0;
      const perTextSpeed = +(properties.speed / springCount).toFixed(1);
      const animationExitConfig = getConfigGroupOutRaw(
        properties.animationId,
        defaultProps,
        {
          ...properties,
          speed: perTextSpeed,
        }
      );
      textApi.start(index => {
        const delayBetweenTexts = index * perTextSpeed;
        return {
          ...animationExitConfig,
          delay: animationDelay + delayBetweenTexts,
          reset: true,
          onStart: () => {
            if (index === 0 && playingRef.current) {
              setAnimating(true);
            }
          },
          onRest: () => {
            animationCount++;
            if (animationCount === springCount && playingRef.current) {
              setFinished(true);
              setAnimating(false);
            }
            resolve();
          },
        };
      });
    });
  };

  const pauseAnimation = () => {
    setPaused(true);
    textApi.pause();
  };

  const resumeAnimation = () => {
    setPaused(false);
    textApi.resume();
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
export default useTextAnimation;
