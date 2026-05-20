// icons.jsx — shared icon set, stroke-based, 16px native, currentColor
const Ico = ({ d, size = 16, sw = 1.5, ch }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    {ch || (typeof d === 'string' ? <path d={d} /> : d)}
  </svg>
);

const Icons = {
  ArrowL: (p) => <Ico {...p} d="M10 12L6 8l4-4" />,
  ArrowR: (p) => <Ico {...p} d="M6 4l4 4-4 4" />,
  ArrowU: (p) => <Ico {...p} d="M4 10l4-4 4 4" />,
  ArrowD: (p) => <Ico {...p} d="M4 6l4 4 4-4" />,
  Close: (p) => <Ico {...p} d="M3 3l10 10M13 3L3 13" />,
  Check: (p) => <Ico {...p} d="M3 8.5l3 3 7-7" />,
  Search: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M13.5 13.5l-3-3" />
        </>
      }
    />
  ),
  Filter: (p) => <Ico {...p} d="M2 4h12M4 8h8M6 12h4" />,
  Plus: (p) => <Ico {...p} d="M8 3v10M3 8h10" />,
  More: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <circle cx="3" cy="8" r="1" />
          <circle cx="8" cy="8" r="1" />
          <circle cx="13" cy="8" r="1" />
        </>
      }
    />
  ),
  Expand: (p) => <Ico {...p} d="M9 2h5v5M7 14H2V9M14 2L9 7M2 14l5-5" />,
  Collapse: (p) => <Ico {...p} d="M14 6h-4V2M2 10h4v4M9 7l5-5M7 9l-5 5" />,
  Side: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M10 3v10" />
        </>
      }
    />
  ),
  Take: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
        </>
      }
    />
  ),
  Run: (p) => <Ico {...p} d="M5 3l8 5-8 5z" />,
  Pause: (p) => <Ico {...p} d="M5 3v10M11 3v10" />,
  Stop: (p) => <Ico {...p} ch={<rect x="4" y="4" width="8" height="8" rx="1" />} />,
  Sun: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" />
        </>
      }
    />
  ),
  Moon: (p) => <Ico {...p} d="M13 9.5A5.5 5.5 0 016.5 3a6 6 0 106.5 6.5z" />,
  GitBranch: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <circle cx="4" cy="3" r="1.5" />
          <circle cx="4" cy="13" r="1.5" />
          <circle cx="12" cy="6" r="1.5" />
          <path d="M4 4.5v7M12 7.5c0 3.5-4 2.5-8 5.5" />
        </>
      }
    />
  ),
  File: (p) => <Ico {...p} d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2zM9 2v4h4" />,
  FilePlus: (p) => (
    <Ico
      {...p}
      d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2zM9 2v4h4M8 9v3M6.5 10.5h3"
    />
  ),
  Folder: (p) => (
    <Ico {...p} d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
  ),
  Code: (p) => <Ico {...p} d="M5 5L2 8l3 3M11 5l3 3-3 3M9.5 4l-3 8" />,
  Bug: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <rect x="5" y="5" width="6" height="8" rx="3" />
          <path d="M5 8H2M11 8h3M5 11H2M11 11h3M3 5l2 2M11 7l2-2M6 5V3M10 5V3" />
        </>
      }
    />
  ),
  Brain: (p) => (
    <Ico
      {...p}
      d="M5.5 3a2 2 0 00-2 2v.5a2 2 0 00-1 1.7v.6a2 2 0 001 1.7v.5a2 2 0 002 2h0M10.5 3a2 2 0 012 2v.5a2 2 0 011 1.7v.6a2 2 0 01-1 1.7v.5a2 2 0 01-2 2M8 3.5v9"
    />
  ),
  Doc: (p) => (
    <Ico {...p} d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1zM5 7h6M5 9.5h6M5 12h4" />
  ),
  Clock: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 2" />
        </>
      }
    />
  ),
  Chat: (p) => (
    <Ico {...p} d="M2 4a1 1 0 011-1h10a1 1 0 011 1v6a1 1 0 01-1 1H6l-3 3v-3H3a1 1 0 01-1-1V4z" />
  ),
  Coin: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M6 9.5c0 1 1 1.5 2 1.5s2-.4 2-1.4S9 8.5 8 8.5 6 8 6 7s1-1.5 2-1.5 2 .5 2 1.5M8 4.5v7" />
        </>
      }
    />
  ),
  CheckList: (p) => (
    <Ico {...p} d="M2 4l1.5 1.5L6 3M2 8.5l1.5 1.5L6 7.5M2 13l1.5 1.5L6 12M9 4h5M9 8.5h5M9 13h5" />
  ),
  Eye: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
        </>
      }
    />
  ),
  Spark: (p) => <Ico {...p} d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" />,
  Cmd: (p) => (
    <Ico
      {...p}
      d="M5 3a2 2 0 00-2 2v0a2 2 0 002 2h6a2 2 0 002-2v0a2 2 0 00-2-2v0a2 2 0 00-2 2v6a2 2 0 002 2v0a2 2 0 002-2v0a2 2 0 00-2-2H5a2 2 0 00-2 2v0a2 2 0 002 2v0a2 2 0 002-2V5a2 2 0 00-2-2z"
      sw={1.2}
    />
  ),
  Bolt: (p) => <Ico {...p} d="M9 2L3 9h4l-1 5 6-7H8l1-5z" />,
  Globe: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12M8 2c2 2 3 4 3 6s-1 4-3 6c-2-2-3-4-3-6s1-4 3-6z" />
        </>
      }
    />
  ),
  Link: (p) => (
    <Ico
      {...p}
      d="M7 9.5L9.5 7M6.5 5L8 3.5a2.1 2.1 0 013 3L9.5 8M9.5 11L8 12.5a2.1 2.1 0 01-3-3L6.5 8"
    />
  ),
  Term: (p) => (
    <Ico
      {...p}
      d="M2 4a1 1 0 011-1h10a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V4zM4.5 6.5l2 1.5-2 1.5M8 10h3"
    />
  ),
  Tools: (p) => <Ico {...p} d="M3 13l3-3M5 11l-2 2-1-1 2-2M9 5l4-2-1 4-3 1-1-3zM6 8l3 3" />,
  Sliders: (p) => (
    <Ico
      {...p}
      d="M3 5h10M3 11h10"
      ch={
        <>
          <path d="M3 5h10M3 11h10" />
          <circle cx="6" cy="5" r="1.5" fill="currentColor" />
          <circle cx="10" cy="11" r="1.5" fill="currentColor" />
        </>
      }
    />
  ),
  Tag: (p) => <Ico {...p} d="M2 8V3h5l7 7-5 5-7-7zM5 5h.01" />,
  Refresh: (p) => <Ico {...p} d="M13 4v3h-3M3 12V9h3M3 9a5 5 0 019-2M13 7a5 5 0 01-9 2" />,
  Layers: (p) => <Ico {...p} d="M8 2l6 3-6 3-6-3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3" />,
  Trend: (p) => <Ico {...p} d="M2 12l4-4 3 3 5-6M9 5h4v4" />,
  Bell: (p) => <Ico {...p} d="M4 11V7a4 4 0 018 0v4l1 2H3l1-2zM6.5 13a1.5 1.5 0 003 0" />,
  Person: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <circle cx="8" cy="5" r="2.5" />
          <path d="M3 13a5 5 0 0110 0" />
        </>
      }
    />
  ),
  Pen: (p) => <Ico {...p} d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5zM10 4l2 2" />,
  History: (p) => (
    <Ico
      {...p}
      ch={
        <>
          <path d="M2 8a6 6 0 106-6V0M2 4v3h3" />
          <path d="M8 5v3l2 2" />
        </>
      }
    />
  ),
};

window.Icons = Icons;
window.Ico = Ico;
