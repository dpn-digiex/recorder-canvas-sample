import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { editorStore } from "@components/canvasEditor/store/canvas/rootStore";
import { CANVAS_MODE } from "@components/canvasEditor/styleOptions";
import Slider from "@components/common/Slider";
import { ELEMENT_TEMPLATE_TYPE } from "@constants";
import { getAdminConfig } from "@services/templateServices";
import { base64ToBlob } from "@utils/exporter";
// import { base64ToBlob } from "@utils/exporter";
import { observer } from "mobx-react";
import RecordRTC from "recordrtc";

import AnimationCanvas from "../animationCanvas";

// import WrapperTextAnimation from "./element/textAnimation/wrapperText";
import styles from "./index.module.scss";

// flow exporter in exporter workspace
// s1: client call api in server to export with template id
// S2: server using puppeteer to open browser with url _ https://urlbase.com/exporter?sizeId=$templateSizeId&authToken=$authTokenValue
// s3: exporter workspace will be use templateSizeId & authToken to get template detail and admin config
// s4: listen state loading of template and automatic trigger start record video
// __during recorder process will be handle error message send from ExporterWorkspace through create element DOM with error message & server querySelector to get error message
// __server mapping with message emit to handle error cases
// s5: when video is finished, encapsulate webm data and send it to the server
// s6: puppeteer will be get webm data -> close browser -> convert webm to mp4 -> response mp4 video to client
// s0: complete flow

const TIMEOUT_ACCEPTED = 30000; // 30s
// const FRAME_RATE = 60; // fps
const CANVAS_ID = "canvas-recorder";
const BLOB_VIDEO_ID = "blob-video-template";
const VIDEO_PATH_ID = "video-path";
const BLOB_THUMBNAIL_ID = "blob-thumbnail-template";
const DELAY_SEND_MSS_SUCCESS = 200; // 0.2s
const MESSAGE_ERROR_ID = "recorder-message-error";
const MESSAGE_SUCCESS_ID = "finish-prepare-data-export";
const IDEAL_RESOLUTION = 1920; // pixel

//? recommended bits per second for video quality
// bits_per_second = 40000000 for 4K video (3840x2160),
// bits_per_second = 16000000 for 2K video (2560x1440),
// bits_per_second = 8000000 for 1080p video (1920x1080),
// bits_per_second = 5000000 for 720p video (1280x720),
// bits_per_second = 2500000 for 480p video (854x480),
// bits_per_second = 1000000 for 360p video (640x360),

const MESSAGE_EMIT = {
  TIMEOUT: "The process to render template is taking too long!",
  GET_TEMPLATE_DATA_ERROR: "Error when get template data!",
  REQUIRED_TEMPLATE_INFO: "This template is missing domainId or sizeId!",
};

const authToken = "1";
const testDownloadWebm = false;

const ExporterWorkspace = observer(({ getTemplateDetail = () => {} }) => {
  const [finishedRecord, setFinishedRecord] = useState(false);
  const [thumbnailPoster, setThumbnailPoster] = useState(null);
  const [isLoading, setIsLoading] = useState({
    template: false,
    adminConfig: false,
  });
  const [resolution, setResolution] = useState({
    width: 0,
    height: 0,
    scale: 0,
  });
  const [preparedDataExport, setPreparedDataExport] = useState({
    video: false,
    poster: false,
  });
  const [templateInfo, setTemplateInfo] = useState({
    templateId: "",
    domainId: "",
  });

  const [searchParams] = useSearchParams();

  const sizeId = searchParams.get("sizeId");
  const extension = searchParams.get("extension");

  // const authToken = searchParams.get("authToken");
  // const domainId = searchParams.get("domainId");

  const recorder = useRef(null);

  const allowInitRecorder = useMemo(() => {
    return (
      !isLoading.adminConfig &&
      !isLoading.template &&
      resolution.scale > 0 &&
      editorStore.availablePages?.length > 0 &&
      thumbnailPoster
    );
  }, [
    isLoading.adminConfig,
    isLoading.template,
    editorStore.availablePages,
    resolution.scale,
    thumbnailPoster,
  ]);

  const getAnimationAdminConfig = async () => {
    setIsLoading(prev => ({ ...prev, adminConfig: true }));
    const result = await getAdminConfig(authToken);
    editorStore.setAnimationAdminConfig(result?.config || {});
    setIsLoading(prev => ({ ...prev, adminConfig: false }));
  };

  const getTemplateData = async () => {
    setIsLoading(prev => ({ ...prev, template: true }));
    const result = await getTemplateDetail(
      { templateSizeId: sizeId },
      authToken
    );
    if (result?.length > 0) {
      if (!result[0]?.templateId && !result[0]?.domainId) {
        createMessageElement(MESSAGE_EMIT.REQUIRED_TEMPLATE_INFO);
      } else {
        editorStore.setStore({ pages: result, templateSizeId: sizeId }, true);
        setTemplateInfo({
          templateId: result[0].templateId,
          domainId: result[0].domainId,
        });
      }
    } else {
      console.log("__ERROR GET TEMPLATE DATA__");
      createMessageElement(MESSAGE_EMIT.GET_TEMPLATE_DATA_ERROR);
    }
    setIsLoading(prev => ({ ...prev, template: false }));
  };

  const initStores = () => {
    editorStore.init();
  };

  const destroyStores = () => {
    editorStore.destroy();
  };

  useEffect(() => {
    initStores();
    getAnimationAdminConfig();
    getTemplateData();
    return () => {
      destroyStores();
    };
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!editorStore.isFinishedRenderTemplate && !finishedRecord) {
        console.log("CLIENT LOG: __TIMEOUT RENDER TEMPLATE__");
        createMessageElement(MESSAGE_EMIT.TIMEOUT);
      }
    }, TIMEOUT_ACCEPTED);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [editorStore.isFinishedRenderTemplate, finishedRecord]);

  // adjust resolution size to smooth animation on canvas
  useEffect(() => {
    if (editorStore.width && editorStore.height) {
      adjustResolutionSize(editorStore.width, editorStore.height);
    }
  }, [editorStore.width, editorStore.height]);

  // start record video when all conditions are met
  useEffect(() => {
    if (editorStore.isFinishedRenderTemplate && allowInitRecorder) {
      initRecorder().then(() => {
        startRecordVideo();
      });
    }
  }, [editorStore.isFinishedRenderTemplate, allowInitRecorder]);

  // finish record video when animation is completed
  // useEffect(() => {
  //   if (animationStore.stateVideoAnimate === PREVIEW_STATE.FINISHED) {
  //     finishRecordVideo();
  //   }
  // }, [animationStore.stateVideoAnimate]);

  // wait to prepare data export & send notification to server
  useEffect(() => {
    if (preparedDataExport.video && preparedDataExport.poster) {
      console.log("FINISH PREPARE DATA EXPORT");
      setTimeout(() => {
        createMessageElement("", MESSAGE_SUCCESS_ID);
      }, DELAY_SEND_MSS_SUCCESS);
    }
  }, [preparedDataExport]);

  const initRecorder = async () => {
    return new Promise(resolve => {
      const canvas = document.getElementById(CANVAS_ID);
      const canvasStream = canvas?.captureStream();
      const audioOfVideoStreams =
        extension === "gif" ? null : getAudioOfVideoStreams();
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(), // Add video tracks from the canvas
        ...(audioOfVideoStreams
          ? audioOfVideoStreams.stream.getAudioTracks()
          : []), // Add audio tracks from the mixed audio stream
      ]);
      recorder.current = new RecordRTC(combinedStream, {
        type: "video",
        disableLogs: true,
        mimeType: `video/webm;codecs=${extension === "gif" ? "h264" : "vp9"}`,
        // videoBitsPerSecond: 8000000,
        frameInterval: 1,
        quality: 1,
        frameRate: 60,
        video: {
          width: resolution.width,
          height: resolution.height,
        },
      });
      resolve();
    });
  };

  const getAudioOfVideoStreams = () => {
    let audioStreams = [];
    editorStore.availablePages.forEach(page => {
      const children = page.children || [];
      return children
        .filter(
          child =>
            child?.type === ELEMENT_TEMPLATE_TYPE.VIDEO ||
            child?.elementType === ELEMENT_TEMPLATE_TYPE.VIDEO
        )
        .forEach(videoChild => {
          const audioStream = videoChild.image
            ?.captureStream()
            .getAudioTracks()[0];
          if (audioStream) {
            audioStreams.push(audioStream);
          }
        });
    });
    if (audioStreams.length === 0) return null;

    // create only one mixed audio stream
    const audioContext = new AudioContext();
    const mixedAudioStream = audioContext.createMediaStreamDestination();

    audioStreams.forEach(audioTrack => {
      const source = audioContext.createMediaStreamSource(
        new MediaStream([audioTrack])
      );
      source.connect(mixedAudioStream);
    });
    return mixedAudioStream;
  };

  const startRecordVideo = () => {
    console.log("START RECORDING");
    // animationStore.videoActions?.play({ modeExporter: true });
    setTimeout(() => {
      recorder.current.startRecording();
    }, 100);
  };

  const finishRecordVideo = async () => {
    console.log("COMPLETED RECORDING");
    setFinishedRecord(true);
    // destroyStores();

    const blobPoster = await base64ToBlob(thumbnailPoster, "image/jpeg");
    setTimeout(() => {
      recorder.current.stopRecording(() => {
        const blob = recorder.current.getBlob();

        if (testDownloadWebm) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "test.webm";
          a.click();
        }

        const readerVideo = new FileReader();
        const readerPoster = new FileReader();

        readerVideo.onloadend = () => {
          const pathVideoElement = document.createElement("span");
          pathVideoElement.id = VIDEO_PATH_ID;
          pathVideoElement.innerHTML = `ExportTemplate/${sizeId}.webm`;
          document.body.appendChild(pathVideoElement);

          const blobVideoElement = document.createElement("span");
          blobVideoElement.id = BLOB_VIDEO_ID;
          const base64Video = readerVideo.result.replace(
            /data:video\/webm;codecs=[^;]+;base64,/,
            ""
          );
          blobVideoElement.innerHTML = base64Video;
          document.body.appendChild(blobVideoElement);
          setPreparedDataExport(prev => ({ ...prev, video: true }));
        };

        readerPoster.onloadend = () => {
          const blobThumbnailElement = document.createElement("span");
          blobThumbnailElement.id = BLOB_THUMBNAIL_ID;
          const base64poster = readerPoster.result.replace(
            /data:image\/jpeg;base64,/,
            ""
          );
          blobThumbnailElement.innerHTML = base64poster;
          document.body.appendChild(blobThumbnailElement);
          setPreparedDataExport(prev => ({ ...prev, poster: true }));
        };

        readerVideo.readAsDataURL(blob);
        readerPoster.readAsDataURL(blobPoster);
      });
    }, 100);
  };

  const createMessageElement = (message = "", id) => {
    const messageElement = document.createElement("span");
    messageElement.id = id || MESSAGE_ERROR_ID;
    messageElement.innerHTML = message;
    document.body.appendChild(messageElement);
  };

  const adjustResolutionSize = (originalWidth, originalHeight) => {
    let scale;
    if (originalWidth > originalHeight) {
      scale = IDEAL_RESOLUTION / originalWidth;
    } else {
      scale = IDEAL_RESOLUTION / originalHeight;
    }
    let adjustedWidth = Math.round(originalWidth * scale);
    let adjustedHeight = Math.round(originalHeight * scale);
    if (adjustedWidth % 2 !== 0) {
      adjustedWidth = adjustedWidth + 1;
    }
    if (adjustedHeight % 2 !== 0) {
      adjustedHeight = adjustedHeight + 1;
    }
    setResolution({ width: adjustedWidth, height: adjustedHeight, scale });
  };

  return (
    <div className={styles.wrapperWorkspaces}>
      <div
        className={styles.wrapperVideoStage}
        style={{ width: `${resolution.width}px` }}
      >
        <AnimationCanvas
          getThumbnail={setThumbnailPoster}
          scale={resolution.scale}
          canvasMode={CANVAS_MODE.EXPORTER}
          canvasId={CANVAS_ID}
          editorStore={editorStore}
          storedFonts={editorStore.storedFontsToJS}
        />
        {/* BoxControl */}
        <div
          className={styles.boxControl}
          style={{ width: `${resolution.width}px` }}
        >
          <Slider
            size="small"
            aria-label="Small"
            valueLabelDisplay="auto"
            step={0.1}
            defaultValue={0}
            value={0}
            max={editorStore.totalTime}
            min={0}
            onChange={() => null}
            sx={{
              "& .MuiSlider-thumb:not(.MuiSlider-active)": {
                transition: "left 0.1s ease-in",
              },
              "& .MuiSlider-track": {
                transition: "width 0.1s ease-in",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
});

export default ExporterWorkspace;
