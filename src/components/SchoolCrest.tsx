import React from 'react';

interface SchoolCrestProps {
  className?: string;
}

export const SchoolCrest: React.FC<SchoolCrestProps> = ({ className = 'w-9 h-9' }) => {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M24 3L6 9.5V22.5C6 33.8 13.7 42.7 24 45.5C34.3 42.7 42 33.8 42 22.5V9.5L24 3Z"
        fill="#1E3A8A"
        stroke="#D97706"
        strokeWidth="2.5"
      />
      <path
        d="M24 7L10 12V22.2C10 31.3 16 38.6 24 41.2C32 38.6 38 31.3 38 22.2V12L24 7Z"
        stroke="#F59E0B"
        strokeOpacity="0.45"
        strokeWidth="1"
      />
      {/* Open Academic Book */}
      <path
        d="M14.5 21.5C17.2 20.3 20.8 20.5 24 22.4C27.2 20.5 30.8 20.3 33.5 21.5V31.5C30.8 30.3 27.2 30.5 24 32.4C20.8 30.5 17.2 30.3 14.5 31.5V21.5Z"
        fill="#FFFFFF"
      />
      <path d="M24 22.4V32.4" stroke="#1E3A8A" strokeWidth="1.5" />
      {/* Torch / Star of Excellence */}
      <path
        d="M24 11.5L25.6 15.1L29.5 15.5L26.5 18L27.4 21.8L24 19.7L20.6 21.8L21.5 18L18.5 15.5L22.4 15.1L24 11.5Z"
        fill="#F59E0B"
      />
      {/* Emerald Ribbon Base */}
      <rect x="17" y="34.5" width="14" height="3.2" rx="1.6" fill="#059669" />
    </svg>
  );
};
