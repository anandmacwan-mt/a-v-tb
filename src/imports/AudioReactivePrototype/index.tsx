import svgPaths from "./svg-z2sp8uptcp";

function Slide() {
  return (
    <div className="-translate-x-1/2 -translate-y-1/2 absolute flex h-[692.872px] items-center justify-center left-1/2 top-[calc(50%-96.56px)] w-[390px]">
      <div className="flex-none rotate-90">
        <div className="bg-white h-[390px] overflow-clip relative rounded-[8px] w-[692.872px]" data-name="Slide 16:9 - 156">
          <div className="-translate-x-1/2 -translate-y-1/2 absolute flex h-[802.819px] items-center justify-center left-[calc(50%+0.52px)] top-1/2 w-[693.91px]">
            <div className="-rotate-90 flex-none">
              <div className="h-[693.91px] relative w-[802.819px]" data-name="image 421132" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Frame() {
  return (
    <div className="absolute left-[320px] mix-blend-screen size-[14px] top-[898px]" data-name="Frame">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14 14">
        <g id="Frame">
          <path d="M7 9.91667V1.75" id="Vector" stroke="var(--stroke-0, white)" strokeLinecap="round" strokeLinejoin="round" />
          <path d={svgPaths.pa874a00} id="Vector_2" stroke="var(--stroke-0, white)" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11.0833 12.25H2.91667" id="Vector_3" stroke="var(--stroke-0, white)" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
}

function Group() {
  return (
    <div className="-translate-x-1/2 absolute contents left-1/2 mix-blend-screen top-[887px]">
      <div className="-translate-x-1/2 absolute border border-[#242424] border-solid h-[37px] left-[calc(50%+139.5px)] mix-blend-screen rounded-[8px] top-[887px] w-[111px]" />
      <div className="-translate-x-1/2 absolute border border-[#242424] border-solid h-[37px] left-[calc(50%-171px)] mix-blend-screen rounded-[8px] top-[887px] w-[48px]" />
      <div className="-translate-y-1/2 [word-break:break-word] absolute flex flex-col font-['News_Gothic_Std:Medium',sans-serif] justify-center leading-[0] left-[calc(50%+118px)] mix-blend-screen not-italic text-[12px] text-white top-[907px] whitespace-nowrap">
        <p className="leading-[normal]">SAVE VIDEO</p>
      </div>
      <div className="-translate-y-1/2 [word-break:break-word] absolute flex flex-col font-['News_Gothic_Std:Medium',sans-serif] justify-center leading-[0] left-[calc(50%-184px)] mix-blend-screen not-italic text-[12px] text-white top-[907px] whitespace-nowrap">
        <p className="leading-[normal]">PLAY</p>
      </div>
      <Frame />
    </div>
  );
}

export default function AudioReactivePrototype() {
  return (
    <div className="bg-black relative size-full" data-name="Audio Reactive prototype">
      <div className="-translate-x-1/2 -translate-y-1/2 absolute h-[1114px] left-[calc(50%+0.5px)] opacity-20 top-1/2 w-[1289px]" data-name="image 421132" />
      <Slide />
      <div className="-translate-y-1/2 [word-break:break-word] absolute flex flex-col font-['OPTIVenus:Bold',sans-serif] justify-center leading-[0] left-[calc(50%-137px)] not-italic text-[18px] text-white top-[calc(50%+289.5px)] uppercase whitespace-nowrap">
        <p className="leading-[normal]">Norwegian Wood</p>
      </div>
      <div className="-translate-y-1/2 [word-break:break-word] absolute flex flex-col font-['News_Gothic_Std:Medium',sans-serif] justify-center leading-[0] left-[calc(50%-31px)] not-italic text-[12px] text-white top-[calc(50%+318px)] whitespace-nowrap">
        <p className="leading-[normal]">Rubber Soul</p>
      </div>
      <div className="-translate-x-1/2 absolute h-[108px] left-1/2 top-[940px] w-[334px]">
        <div className="absolute inset-[-210.93%_-68.2%]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 789.6 563.6">
            <g filter="url(#filter0_f_1_30)" id="Ellipse 43" opacity="0.2">
              <ellipse cx="394.8" cy="281.8" fill="var(--fill-0, #D9D9D9)" rx="167" ry="54" />
            </g>
            <defs>
              <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="563.6" id="filter0_f_1_30" width="789.6" x="0" y="0">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend in="SourceGraphic" in2="BackgroundImageFix" mode="normal" result="shape" />
                <feGaussianBlur result="effect1_foregroundBlur_1_30" stdDeviation="113.9" />
              </filter>
            </defs>
          </svg>
        </div>
      </div>
      <Group />
      <div className="absolute bg-[#242424] h-[2px] left-[25px] mix-blend-screen rounded-[8px] top-[867px] w-[390px]" />
      <div className="absolute bg-white h-[2px] left-[25px] rounded-[8px] top-[867px] w-[162px]" />
    </div>
  );
}