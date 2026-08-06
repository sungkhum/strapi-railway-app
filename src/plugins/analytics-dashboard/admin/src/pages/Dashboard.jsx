import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Page, useFetchClient } from "@strapi/strapi/admin";
import styled, { keyframes } from "styled-components";

import pluginPermissions from "../permissions";

const METRICS = [
  { key: "views", label: "Views", color: "oklch(0.78 0.09 145)" },
  { key: "audioPlays", label: "Audio plays", color: "oklch(0.77 0.1 68)" },
  { key: "bookOpens", label: "Book opens", color: "oklch(0.73 0.07 235)" },
  { key: "downloads", label: "Downloads", color: "oklch(0.72 0.06 315)" },
];

const HEALTH_ROWS = [
  { key: "withCategories", label: "Categorized" },
  { key: "withAuthors", label: "Author attached" },
  { key: "withTags", label: "Tagged" },
  { key: "withEnglishDescription", label: "English summary" },
  { key: "withEbook", label: "eBook attached" },
  { key: "withAudio", label: "Audio available" },
  { key: "withPurchaseLink", label: "Purchase link" },
];

const RANKING_TABS = [
  { key: "categories", label: "Categories" },
  { key: "authors", label: "Authors" },
  { key: "tags", label: "Tags" },
];

const reveal = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
`;

const pulse = keyframes`
  0%, 100% { opacity: .45; transform: scale(.92); }
  50% { opacity: 1; transform: scale(1); }
`;

const PageCanvas = styled.main`
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;
  --space-3xl: 48px;
  --ink: oklch(0.19 0.018 252);
  --panel: oklch(0.235 0.016 252);
  --panel-soft: oklch(0.265 0.018 252);
  --line: oklch(0.5 0.018 252 / 0.3);
  --muted: oklch(0.73 0.025 252);
  --text: oklch(0.94 0.012 86);
  --acid: oklch(0.78 0.09 145);
  --coral: oklch(0.77 0.1 68);
  min-height: 100%;
  padding: clamp(var(--space-xl), 4vw, 56px);
  color: var(--text);
  background: var(--ink);
  position: relative;
  overflow: hidden;
  font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;

  &::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 220px;
    pointer-events: none;
    border-top: 3px solid var(--acid);
    background: linear-gradient(
      180deg,
      oklch(0.78 0.09 145 / 0.055),
      transparent
    );
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
    }
  }
`;

const Content = styled.div`
  width: min(1480px, 100%);
  margin: 0 auto;
  position: relative;
  z-index: 1;
`;

const Header = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: var(--space-2xl);
  animation: ${reveal} 300ms cubic-bezier(0.22, 1, 0.36, 1) both;

  @media (max-width: 700px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

const Eyebrow = styled.p`
  margin: 0 0 12px;
  color: var(--acid);
  font: 700 11px/1.2 "Avenir Next", Avenir, sans-serif;
  letter-spacing: 0.16em;
  text-transform: uppercase;
`;

const Title = styled.h1`
  max-width: 720px;
  margin: 0;
  font: 540 42px/1.05 Charter, "Iowan Old Style", Georgia, serif;
  letter-spacing: -0.035em;

  @media (max-width: 700px) {
    font-size: 34px;
  }
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const LiveBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--muted);
  background: var(--panel);
  font: 650 10px/1 "Avenir Next", Avenir, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  &::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--acid);
  }
`;

const RefreshButton = styled.button`
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid var(--acid);
  border-radius: 4px;
  color: var(--ink);
  background: var(--acid);
  cursor: pointer;
  font: 750 10px/1 "Avenir Next", Avenir, sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);

  &:hover:not(:disabled) {
    transform: translateY(-2px);
  }

  &:focus-visible {
    outline: 3px solid oklch(0.73 0.07 235 / 0.7);
    outline-offset: 3px;
  }

  &:disabled {
    cursor: wait;
    opacity: 0.65;
  }
`;

const Grid = styled.section`
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--space-lg);
  margin-bottom: var(--space-lg);
`;

const Panel = styled.article`
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  box-shadow: 0 12px 32px oklch(0.08 0.01 252 / 0.16);
  animation: ${reveal} 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: ${({ $delay = 0 }) => `${$delay}ms`};
`;

const SignalLedger = styled(Panel)`
  grid-column: span 12;
  display: grid;
  grid-template-columns: minmax(250px, 1.35fr) repeat(4, minmax(130px, 1fr));
  overflow: hidden;

  @media (max-width: 980px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const LedgerIntro = styled.div`
  min-height: 180px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--space-xl);
  padding: var(--space-xl);
  background: var(--panel-soft);

  @media (max-width: 980px) {
    grid-column: 1 / -1;
  }
`;

const LedgerMetric = styled.div`
  min-height: 180px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: var(--space-xl);
  border-left: 1px solid var(--line);

  @media (max-width: 980px) {
    border-top: 1px solid var(--line);

    &:nth-child(2n) {
      border-left: 0;
    }
  }

  @media (max-width: 560px) {
    min-height: 132px;
    border-left: 0;
  }
`;

const LedgerTotal = styled.p`
  margin: var(--space-sm) 0 0;
  font: 540 40px/1 Charter, "Iowan Old Style", Georgia, serif;
  letter-spacing: -0.035em;
`;

const LedgerValue = styled.p`
  margin: var(--space-lg) 0 0;
  font: 540 32px/1 Charter, "Iowan Old Style", Georgia, serif;
  letter-spacing: -0.03em;
`;

const MetricKey = styled.span`
  width: 18px;
  height: 3px;
  background: ${({ $color }) => $color};
`;

const Label = styled.p`
  margin: 0;
  color: var(--muted);
  font: 700 10px/1.3 "Avenir Next", Avenir, sans-serif;
  letter-spacing: 0.09em;
  text-transform: uppercase;
`;

const FinePrint = styled.p`
  margin: 0;
  max-width: 39ch;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
`;

const Composition = styled.div`
  display: flex;
  height: 8px;
  margin: 19px 0 15px;
  overflow: hidden;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.06);
`;

const CompositionSegment = styled.span`
  width: ${({ $width }) => `${$width}%`};
  min-width: ${({ $width }) => ($width > 0 ? "2px" : "0")};
  background: ${({ $color }) => $color};
`;

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 22px;

  h2 {
    margin: 0;
    font: 540 24px/1.15 Charter, "Iowan Old Style", Georgia, serif;
    letter-spacing: -0.025em;
  }

  span {
    color: var(--muted);
    font: 650 10px/1 "Avenir Next", Avenir, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
`;

const CategoryPanel = styled(Panel)`
  grid-column: span 7;
  min-height: 390px;
  padding: 25px;

  @media (max-width: 980px) {
    grid-column: span 12;
  }
`;

const HealthPanel = styled(Panel)`
  grid-column: span 5;
  min-height: 390px;
  padding: 25px;

  @media (max-width: 980px) {
    grid-column: span 12;
  }
`;

const CategoryList = styled.ol`
  display: grid;
  gap: 17px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const CategoryRow = styled.li`
  display: grid;
  grid-template-columns: minmax(110px, 1.2fr) 3fr auto;
  align-items: center;
  gap: 15px;
  color: var(--text);
  font-size: 13px;

  @media (max-width: 520px) {
    grid-template-columns: 1fr auto;

    > div {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
`;

const BarTrack = styled.div`
  height: 7px;
  overflow: hidden;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.065);
`;

const BarFill = styled.div`
  height: 100%;
  width: ${({ $width }) => `${$width}%`};
  border-radius: inherit;
  background: var(--acid);
  transform-origin: left;
  animation: ${reveal} 680ms ease both;
`;

const MonoValue = styled.span`
  color: var(--muted);
  font: 700 11px/1 "Avenir Next", Avenir, sans-serif;
`;

const EmptyState = styled.div`
  min-height: 245px;
  display: grid;
  place-items: center;
  color: var(--muted);
  text-align: center;
  font-size: 13px;
`;

const RefreshError = styled.div`
  margin: -8px 0 16px;
  padding: 12px 15px;
  border: 1px solid rgba(255, 114, 133, 0.42);
  border-radius: 12px;
  color: #ffd8de;
  background: rgba(255, 114, 133, 0.1);
  font-size: 12px;
  line-height: 1.45;
`;

const HealthList = styled.ul`
  display: grid;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const HealthRow = styled.li`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px 16px;
  align-items: center;
  font-size: 13px;
`;

const HealthTrack = styled.div`
  grid-column: 1 / -1;
  height: 5px;
  overflow: hidden;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.065);
`;

const HealthFill = styled.div`
  width: ${({ $width }) => `${$width}%`};
  height: 100%;
  border-radius: inherit;
  background: ${({ $width }) =>
    $width > 79 ? "var(--acid)" : $width > 49 ? "var(--coral)" : "#ff7285"};
`;

const RatioStrip = styled(Panel)`
  grid-column: span 12;
  display: grid;
  grid-template-columns: 1.3fr repeat(3, 1fr);
  padding: 0;
  overflow: hidden;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const RatioIntro = styled.div`
  padding: 23px;
  background: rgba(185, 244, 93, 0.08);

  h2 {
    margin: 0 0 8px;
    font: 540 22px/1.15 Charter, "Iowan Old Style", Georgia, serif;
  }
`;

const RatioCell = styled.div`
  padding: 23px;
  border-left: 1px solid var(--line);

  @media (max-width: 760px) {
    border-top: 1px solid var(--line);
    border-left: 0;
  }
`;

const RatioValue = styled.p`
  margin: 11px 0 0;
  font: 540 30px/1 Charter, "Iowan Old Style", Georgia, serif;
`;

const InsightStrip = styled(Panel)`
  grid-column: span 12;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;

  @media (max-width: 780px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const InsightCell = styled.div`
  min-height: 122px;
  padding: 22px;
  border-left: 1px solid var(--line);

  &:first-child {
    border-left: 0;
  }

  @media (max-width: 780px) {
    &:nth-child(3) {
      border-left: 0;
    }

    &:nth-child(n + 3) {
      border-top: 1px solid var(--line);
    }
  }
`;

const InsightValue = styled.p`
  margin: 15px 0 7px;
  color: ${({ $accent }) => $accent || "var(--text)"};
  font: 540 36px/1 Charter, "Iowan Old Style", Georgia, serif;
  letter-spacing: -0.03em;
`;

const FreshPanel = styled(Panel)`
  grid-column: span 12;
  padding: var(--space-xl);
`;

const FreshHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-lg);
  margin-bottom: var(--space-xl);

  h2 {
    margin: 0 0 6px;
    font: 540 27px/1 Charter, "Iowan Old Style", Georgia, serif;
  }

  @media (max-width: 700px) {
    flex-direction: column;
  }
`;

const FreshBadge = styled.span`
  padding: 7px 9px;
  border: 1px solid oklch(0.78 0.09 145 / 0.45);
  border-radius: 3px;
  color: var(--acid);
  font: 700 9px/1 "Avenir Next", Avenir, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const FreshMetrics = styled.div`
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid var(--line);
  background: var(--line);

  @media (max-width: 980px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @media (max-width: 560px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const FreshMetric = styled.div`
  min-height: 116px;
  padding: var(--space-lg);
  background: var(--panel-soft);

  strong {
    display: block;
    margin: 12px 0 8px;
    font: 540 28px/1 Charter, "Iowan Old Style", Georgia, serif;
  }
`;

const TrendChart = styled.div`
  height: 126px;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  margin-top: var(--space-xl);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--line);
`;

const TrendDay = styled.div`
  flex: 1;
  min-width: 2px;
  height: ${({ $height }) => `${Math.max(2, $height)}%`};
  border-radius: 2px 2px 0 0;
  background: ${({ $active }) =>
    $active ? "var(--acid)" : "oklch(0.73 0.07 235 / 0.52)"};
`;

const VerifiedBooks = styled.div`
  margin-top: var(--space-xl);
  padding-top: var(--space-xl);
  border-top: 1px solid var(--line);
`;

const ActionMetrics = styled.div`
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 1px;
  margin-top: var(--space-xl);
  border: 1px solid var(--line);
  background: var(--line);

  @media (max-width: 900px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @media (max-width: 520px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const ActionMetric = styled.div`
  padding: var(--space-md) var(--space-lg);
  background: var(--panel-soft);

  strong {
    display: block;
    margin-top: 8px;
    font: 540 22px/1 Charter, "Iowan Old Style", Georgia, serif;
  }
`;

const VerifiedBooksHeader = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 1fr) repeat(3, minmax(72px, 120px));
  gap: var(--space-lg);
  padding: 0 var(--space-sm) var(--space-sm);
  color: var(--muted);
  font: 700 9px/1 "Avenir Next", Avenir, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  @media (max-width: 620px) {
    display: none;
  }
`;

const VerifiedBookRow = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 1fr) repeat(3, minmax(72px, 120px));
  align-items: center;
  gap: var(--space-lg);
  min-height: 56px;
  padding: var(--space-sm);
  border-top: 1px solid oklch(0.5 0.018 252 / 0.18);
  font-size: 12px;

  strong {
    overflow: hidden;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 620px) {
    grid-template-columns: minmax(0, 1fr) auto;

    span:nth-of-type(2),
    span:nth-of-type(3) {
      display: none;
    }
  }
`;

const BooksPanel = styled(Panel)`
  grid-column: span 8;
  padding: 25px;
  overflow: hidden;

  @media (max-width: 1100px) {
    grid-column: span 12;
  }
`;

const RankingTabs = styled.div`
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(5, 12, 25, 0.22);
`;

const RankingTab = styled.button`
  min-height: 30px;
  padding: 0 11px;
  border: 0;
  border-radius: 2px;
  color: ${({ $active }) => ($active ? "var(--ink)" : "var(--muted)")};
  background: ${({ $active }) => ($active ? "var(--acid)" : "transparent")};
  cursor: pointer;
  font: 750 9px/1 "Avenir Next", Avenir, sans-serif;
  letter-spacing: 0.07em;
  text-transform: uppercase;

  &:focus-visible {
    outline: 2px solid oklch(0.73 0.07 235);
    outline-offset: 2px;
  }
`;

const ChartPanel = styled(Panel)`
  grid-column: span 7;
  min-height: 360px;
  padding: 25px;

  @media (max-width: 980px) {
    grid-column: span 12;
  }
`;

const SegmentPanel = styled(Panel)`
  grid-column: span 5;
  min-height: 360px;
  padding: 25px;

  @media (max-width: 980px) {
    grid-column: span 12;
  }
`;

const DistributionChart = styled.div`
  min-height: 250px;
  display: grid;
  grid-template-columns: repeat(5, minmax(54px, 1fr));
  align-items: end;
  gap: clamp(8px, 2vw, 20px);
  padding: 12px 4px 0;
  overflow-x: auto;
`;

const DistributionColumn = styled.div`
  display: grid;
  grid-template-rows: 190px auto auto;
  gap: 9px;
  text-align: center;
`;

const DistributionWell = styled.div`
  height: 190px;
  display: flex;
  align-items: flex-end;
  border-bottom: 1px solid var(--line);
`;

const DistributionBar = styled.div`
  width: 100%;
  height: ${({ $height }) => `${$height}%`};
  min-height: ${({ $height }) => ($height > 0 ? "4px" : "0")};
  border-radius: 9px 9px 2px 2px;
  background: var(--acid);
  animation: ${reveal} 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
`;

const ChartValue = styled.strong`
  color: var(--text);
  font: 540 20px/1 Charter, "Iowan Old Style", Georgia, serif;
`;

const ChartLabel = styled.span`
  color: var(--muted);
  font: 700 9px/1.25 "Avenir Next", Avenir, sans-serif;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const SegmentList = styled.ul`
  display: grid;
  gap: 20px;
  margin: 0 0 24px;
  padding: 0;
  list-style: none;
`;

const SegmentRow = styled.li`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 9px 14px;
  align-items: end;
`;

const SegmentMeta = styled.span`
  color: var(--muted);
  font-size: 11px;
`;

const SegmentTrack = styled.div`
  grid-column: 1 / -1;
  height: 8px;
  overflow: hidden;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.06);
`;

const SegmentFill = styled.div`
  width: ${({ $width }) => `${$width}%`};
  height: 100%;
  min-width: ${({ $width }) => ($width > 0 ? "3px" : "0")};
  border-radius: inherit;
  background: var(--coral);
`;

const OpportunityPanel = styled(Panel)`
  grid-column: span 4;
  padding: 25px;

  @media (max-width: 1100px) {
    grid-column: span 12;
  }
`;

const OpportunityList = styled.ol`
  display: grid;
  gap: 0;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
`;

const OpportunityItem = styled.li`
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 14px 0;
  border-top: 1px solid var(--line);

  > div {
    min-width: 0;
  }

  &:first-child {
    padding-top: 0;
    border-top: 0;
  }
`;

const OpportunityRank = styled.span`
  color: var(--coral);
  font: 700 11px/1 "Avenir Next", Avenir, sans-serif;
`;

const OpportunityMetric = styled.div`
  text-align: right;

  strong {
    display: block;
    color: var(--text);
    font: 540 18px/1 Charter, "Iowan Old Style", Georgia, serif;
  }

  span {
    color: var(--muted);
    font: 650 8px/1 "Avenir Next", Avenir, sans-serif;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
`;

const TableWrap = styled.div`
  overflow-x: auto;
`;

const BooksTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  min-width: 680px;

  th {
    padding: 0 10px 13px;
    color: var(--muted);
    font: 700 10px/1 "Avenir Next", Avenir, sans-serif;
    letter-spacing: 0.08em;
    text-align: right;
    text-transform: uppercase;
  }

  th:nth-child(2) {
    text-align: left;
  }

  td {
    padding: 15px 10px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font: 650 11px/1.2 "Avenir Next", Avenir, sans-serif;
    text-align: right;
  }

  td:nth-child(2) {
    max-width: 260px;
    text-align: left;
  }
`;

const Rank = styled.span`
  color: var(--acid);
`;

const BookLink = styled(Link)`
  display: block;
  overflow: hidden;
  color: var(--text);
  font: 550 14px/1.25 Charter, "Iowan Old Style", Georgia, serif;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration: none;

  &:hover {
    color: var(--acid);
  }

  &:focus-visible {
    outline: 2px solid var(--acid);
    outline-offset: 3px;
  }
`;

const BookCategory = styled.small`
  display: block;
  margin-top: 5px;
  color: var(--muted);
  font: 650 9px/1 "Avenir Next", Avenir, sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const Inventory = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 22px;
  padding-top: 19px;
  border-top: 1px solid var(--line);

  @media (max-width: 520px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;

const InventoryItem = styled.div`
  strong {
    display: block;
    margin-bottom: 5px;
    color: var(--text);
    font: 540 23px/1 Charter, "Iowan Old Style", Georgia, serif;
  }

  span {
    color: var(--muted);
    font: 650 9px/1 "Avenir Next", Avenir, sans-serif;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
`;

const StateScreen = styled(PageCanvas)`
  display: grid;
  place-items: center;
  min-height: calc(100vh - 56px);
`;

const StateCard = styled(Panel)`
  width: min(480px, 100%);
  padding: 34px;
  text-align: center;

  h1 {
    margin: 0 0 12px;
    font: 540 34px/1 Charter, "Iowan Old Style", Georgia, serif;
  }
`;

const LoadingMark = styled.div`
  width: 48px;
  height: 48px;
  margin: 0 auto 24px;
  border: 1px solid var(--line);
  border-top-color: var(--acid);
  border-radius: 50%;
  animation: ${pulse} 750ms ease-in-out infinite;
`;

const formatNumber = (value) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    Number(value) || 0
  );

const formatExact = (value) => new Intl.NumberFormat("en").format(Number(value) || 0);

const formatDate = (value) => {
  if (!value) return "No update date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
};

const safePercent = (value, total) =>
  total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;

const DashboardContent = () => {
  const { get } = useFetchClient();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [rankingKey, setRankingKey] = useState("categories");

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    setError("");

    try {
      const response = await get("/analytics-dashboard/dashboard");
      setData(response.data);
    } catch (requestError) {
      setError(
        requestError?.message ||
          "The analytics endpoint could not be reached. Check the server logs and try again."
      );
    } finally {
      setRefreshing(false);
    }
  }, [get]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const composition = data
    ? METRICS.map((metric) => ({
      ...metric,
      value: data.totals[metric.key],
      percent: safePercent(data.totals[metric.key], data.totals.engagement),
    }))
    : [];

  if (!data && !error) {
    return (
      <StateScreen>
        <StateCard>
          <LoadingMark />
          <h1>Reading the catalog</h1>
          <FinePrint>
            Adding the lifetime engagement counters and checking content coverage.
          </FinePrint>
        </StateCard>
      </StateScreen>
    );
  }

  if (!data && error) {
    return (
      <StateScreen>
        <StateCard>
          <Eyebrow>Analytics unavailable</Eyebrow>
          <h1>We lost the signal.</h1>
          <FinePrint>{error}</FinePrint>
          <RefreshButton type="button" onClick={loadDashboard}>
            Try again
          </RefreshButton>
        </StateCard>
      </StateScreen>
    );
  }

  const publishedBooks = data.totals.publishedBooks || 0;
  const activeRanking = data.rankings[rankingKey] || [];
  const strongestRanking = activeRanking[0]?.engagement || 0;
  const distributionMax = Math.max(
    1,
    ...data.distribution.map((bucket) => bucket.books)
  );
  const segmentMax = Math.max(
    1,
    ...data.segments.map((segment) => segment.engagementPerBook)
  );
  const firstParty = data.firstParty;
  const trendMax = Math.max(
    1,
    ...(firstParty?.trend || []).map(
      (day) => day.bookViews + day.audioStarts + day.ebookOpens + day.devotionalViews
    )
  );

  return (
    <PageCanvas>
      <Content>
        <Header>
          <div>
            <Eyebrow>PlovPit / lifetime catalog signals</Eyebrow>
            <Title>Library analytics.</Title>
          </div>
          <HeaderActions>
            <LiveBadge>{formatDate(data.generatedAt)}</LiveBadge>
            <RefreshButton type="button" onClick={loadDashboard} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </RefreshButton>
          </HeaderActions>
        </Header>

        {error ? (
          <RefreshError role="status">
            The latest refresh failed, so this page is showing the previous snapshot.
            Try refreshing again.
          </RefreshError>
        ) : null}

        <Grid aria-label="Lifetime engagement overview">
          <SignalLedger $delay={40}>
            <LedgerIntro>
              <div>
                <Label>Total engagement</Label>
                <LedgerTotal title={formatExact(data.totals.engagement)}>
                  {formatNumber(data.totals.engagement)}
                </LedgerTotal>
              </div>
              <FinePrint>
                Every view, play, open, and download currently stored on published books.
              </FinePrint>
              <div>
                <Composition aria-label="Engagement composition">
                  {composition.map((metric) => (
                    <CompositionSegment
                      key={metric.key}
                      $width={metric.percent}
                      $color={metric.color}
                      title={`${metric.label}: ${formatExact(metric.value)}`}
                    />
                  ))}
                </Composition>
              </div>
            </LedgerIntro>

            {composition.map((metric) => (
              <LedgerMetric key={metric.key}>
                <MetricKey $color={metric.color} />
                <div>
                  <Label>{metric.label}</Label>
                  <LedgerValue title={formatExact(metric.value)}>
                    {formatNumber(metric.value)}
                  </LedgerValue>
                </div>
                <FinePrint>{Math.round(metric.percent)}% of all signal</FinePrint>
              </LedgerMetric>
            ))}
          </SignalLedger>
        </Grid>

        {firstParty?.available ? (
          <Grid aria-label="Verified recent engagement">
            <FreshPanel $delay={95}>
              <FreshHeader>
                <div>
                  <h2>Verified engagement</h2>
                  <FinePrint>
                    Anonymous, opt-in activity confirmed by player, reader, and
                    download state—not button taps.
                  </FinePrint>
                </div>
                <FreshBadge>
                  {firstParty.truncated ? "Latest 100k · " : ""}
                  {firstParty.periodDays} day window
                </FreshBadge>
              </FreshHeader>

              <FreshMetrics>
                <FreshMetric>
                  <Label>Active installs</Label>
                  <strong>{formatNumber(firstParty.totals.activeUsers)}</strong>
                  <FinePrint>Anonymous and resettable.</FinePrint>
                </FreshMetric>
                <FreshMetric>
                  <Label>Book views</Label>
                  <strong>{formatNumber(firstParty.totals.bookViews)}</strong>
                  <FinePrint>Displayed detail screens.</FinePrint>
                </FreshMetric>
                <FreshMetric>
                  <Label>Valid audio starts</Label>
                  <strong>{formatNumber(firstParty.totals.audioStarts)}</strong>
                  <FinePrint>{firstParty.rates.audioStartPerView}% per view</FinePrint>
                </FreshMetric>
                <FreshMetric>
                  <Label>Listening hours</Label>
                  <strong>{formatExact(firstParty.totals.listeningHours)}</strong>
                  <FinePrint>{formatNumber(firstParty.totals.listeners)} listeners</FinePrint>
                </FreshMetric>
                <FreshMetric>
                  <Label>eBook opens</Label>
                  <strong>{formatNumber(firstParty.totals.ebookOpens)}</strong>
                  <FinePrint>{firstParty.rates.ebookCompletionRate}% completed</FinePrint>
                </FreshMetric>
                <FreshMetric>
                  <Label>Devotional views</Label>
                  <strong>{formatNumber(firstParty.totals.devotionalViews)}</strong>
                  <FinePrint>
                    {firstParty.rates.devotionalEngagementRate}% engaged
                  </FinePrint>
                </FreshMetric>
              </FreshMetrics>

              <TrendChart aria-label="Thirty day verified engagement trend">
                {firstParty.trend.map((day, index) => {
                  const value =
                    day.bookViews +
                    day.audioStarts +
                    day.ebookOpens +
                    day.devotionalViews;
                  return (
                    <TrendDay
                      key={day.date}
                      $height={(value / trendMax) * 100}
                      $active={index === firstParty.trend.length - 1}
                      title={`${formatDate(day.date)}: ${formatExact(value)} verified actions`}
                    />
                  );
                })}
              </TrendChart>

              <ActionMetrics aria-label="Thirty day discovery and action metrics">
                {[
                  ["Searches", firstParty.totals.searches],
                  ["Results opened", firstParty.totals.searchResultOpens],
                  ["Downloads", firstParty.totals.downloadCompletions],
                  ["Bookmarks", firstParty.totals.bookmarks],
                  ["Purchase clicks", firstParty.totals.purchaseClicks],
                  ["Push opens", firstParty.totals.notificationOpens],
                ].map(([label, value]) => (
                  <ActionMetric key={label}>
                    <Label>{label}</Label>
                    <strong>{formatNumber(value)}</strong>
                  </ActionMetric>
                ))}
              </ActionMetrics>

              <VerifiedBooks>
                <SectionTitle>
                  <h2>Top verified books</h2>
                  <span>Views · starts · listening</span>
                </SectionTitle>
                {firstParty.topBooks.length ? (
                  <>
                    <VerifiedBooksHeader aria-hidden="true">
                      <span>Book</span>
                      <span>Views</span>
                      <span>Audio starts</span>
                      <span>Hours</span>
                    </VerifiedBooksHeader>
                    {firstParty.topBooks.slice(0, 6).map((book) => (
                      <VerifiedBookRow key={book.documentId}>
                        <strong title={book.title}>{book.title}</strong>
                        <span>{formatNumber(book.views)}</span>
                        <span>{formatNumber(book.audioStarts)}</span>
                        <span>{formatExact(book.listeningHours)}</span>
                      </VerifiedBookRow>
                    ))}
                  </>
                ) : (
                  <FinePrint>
                    Book rankings will appear after opted-in readers start
                    viewing, listening, or reading.
                  </FinePrint>
                )}
              </VerifiedBooks>
            </FreshPanel>
          </Grid>
        ) : null}

        <Grid>
          <RatioStrip $delay={130}>
            <RatioIntro>
              <h2>Depth after discovery</h2>
              <FinePrint>
                Actions divided by views. Useful for comparison, not a strict user funnel.
              </FinePrint>
            </RatioIntro>
            <RatioCell>
              <Label>Audio plays / view</Label>
              <RatioValue>{data.rates.audioPlayPerView}%</RatioValue>
            </RatioCell>
            <RatioCell>
              <Label>Book opens / view</Label>
              <RatioValue>{data.rates.bookOpenPerView}%</RatioValue>
            </RatioCell>
            <RatioCell>
              <Label>Downloads / view</Label>
              <RatioValue>{data.rates.downloadPerView}%</RatioValue>
            </RatioCell>
          </RatioStrip>
        </Grid>

        <Grid aria-label="Catalog signal summary">
          <InsightStrip $delay={150}>
            <InsightCell>
              <Label>Average / book</Label>
              <InsightValue>
                {formatNumber(data.insights.averageEngagementPerBook)}
              </InsightValue>
              <FinePrint>Mean lifetime actions across published books.</FinePrint>
            </InsightCell>
            <InsightCell>
              <Label>Median / book</Label>
              <InsightValue $accent="oklch(0.73 0.07 235)">
                {formatNumber(data.insights.medianEngagementPerBook)}
              </InsightValue>
              <FinePrint>The typical book, less distorted by leaders.</FinePrint>
            </InsightCell>
            <InsightCell>
              <Label>Books with signal</Label>
              <InsightValue $accent="oklch(0.78 0.09 145)">
                {data.insights.activeBookRate}%
              </InsightValue>
              <FinePrint>
                {data.insights.activeBooks} active · {data.insights.inactiveBooks} quiet
              </FinePrint>
            </InsightCell>
            <InsightCell>
              <Label>Top 10 share</Label>
              <InsightValue $accent="oklch(0.77 0.1 68)">
                {data.insights.topTenShare}%
              </InsightValue>
              <FinePrint>How concentrated engagement is among leaders.</FinePrint>
            </InsightCell>
          </InsightStrip>
        </Grid>

        <Grid>
          <CategoryPanel $delay={170}>
            <SectionTitle>
              <h2>Engagement leaders</h2>
              <RankingTabs role="group" aria-label="Ranking dimension">
                {RANKING_TABS.map((tab) => (
                  <RankingTab
                    key={tab.key}
                    type="button"
                    aria-pressed={rankingKey === tab.key}
                    $active={rankingKey === tab.key}
                    onClick={() => setRankingKey(tab.key)}
                  >
                    {tab.label}
                  </RankingTab>
                ))}
              </RankingTabs>
            </SectionTitle>
            {activeRanking.length ? (
              <CategoryList>
                {activeRanking.map((group) => (
                  <CategoryRow key={group.name}>
                    <span>{group.name}</span>
                    <BarTrack>
                      <BarFill
                        $width={safePercent(group.engagement, strongestRanking)}
                      />
                    </BarTrack>
                    <MonoValue>
                      {formatNumber(group.engagement)} · {group.books} books
                    </MonoValue>
                  </CategoryRow>
                ))}
              </CategoryList>
            ) : (
              <EmptyState>Publish connected content to see this ranking.</EmptyState>
            )}
          </CategoryPanel>

          <HealthPanel $delay={210}>
            <SectionTitle>
              <h2>Catalog readiness</h2>
              <span>{publishedBooks} published</span>
            </SectionTitle>
            <HealthList>
              {HEALTH_ROWS.map((row) => {
                const value = data.contentHealth[row.key] || 0;
                const percent = safePercent(value, publishedBooks);
                return (
                  <HealthRow key={row.key}>
                    <span>{row.label}</span>
                    <MonoValue>
                      {value}/{publishedBooks} · {Math.round(percent)}%
                    </MonoValue>
                    <HealthTrack>
                      <HealthFill $width={percent} />
                    </HealthTrack>
                  </HealthRow>
                );
              })}
            </HealthList>
            <Inventory aria-label="Catalog inventory">
              <InventoryItem>
                <strong>{data.totals.books}</strong>
                <span>Books</span>
              </InventoryItem>
              <InventoryItem>
                <strong>{data.totals.categories}</strong>
                <span>Categories</span>
              </InventoryItem>
              <InventoryItem>
                <strong>{data.totals.authors}</strong>
                <span>Authors</span>
              </InventoryItem>
              <InventoryItem>
                <strong>{data.totals.tags}</strong>
                <span>Tags</span>
              </InventoryItem>
            </Inventory>
          </HealthPanel>
        </Grid>

        <Grid>
          <ChartPanel $delay={230}>
            <SectionTitle>
              <h2>Engagement distribution</h2>
              <span>Published books · lifetime actions</span>
            </SectionTitle>
            <DistributionChart
              role="img"
              aria-label={data.distribution
                .map((bucket) => `${bucket.label}: ${bucket.books} books`)
                .join(", ")}
            >
              {data.distribution.map((bucket) => (
                <DistributionColumn key={bucket.key}>
                  <DistributionWell>
                    <DistributionBar
                      $height={safePercent(bucket.books, distributionMax)}
                    />
                  </DistributionWell>
                  <ChartValue>{bucket.books}</ChartValue>
                  <ChartLabel>{bucket.label}</ChartLabel>
                </DistributionColumn>
              ))}
            </DistributionChart>
          </ChartPanel>

          <SegmentPanel $delay={250}>
            <SectionTitle>
              <h2>Format lift</h2>
              <span>Engagement per book</span>
            </SectionTitle>
            <SegmentList>
              {data.segments.map((segment) => (
                <SegmentRow key={segment.key}>
                  <div>
                    <span>{segment.label}</span>
                    <SegmentMeta> · {segment.books} books</SegmentMeta>
                  </div>
                  <MonoValue>
                    {formatNumber(segment.engagementPerBook)} / book
                  </MonoValue>
                  <SegmentTrack>
                    <SegmentFill
                      $width={safePercent(
                        segment.engagementPerBook,
                        segmentMax
                      )}
                    />
                  </SegmentTrack>
                </SegmentRow>
              ))}
            </SegmentList>
            <FinePrint>
              Directional comparison only; featured and format groups can overlap.
            </FinePrint>
          </SegmentPanel>
        </Grid>

        <Grid>
          <BooksPanel $delay={250}>
            <SectionTitle>
              <h2>Top-performing books</h2>
              <span>Top 10 · all actions</span>
            </SectionTitle>
            {data.topBooks.length ? (
              <TableWrap>
                <BooksTable>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Book</th>
                      <th>Total</th>
                      <th>Views</th>
                      <th>Plays</th>
                      <th>Opens</th>
                      <th>Downloads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topBooks.map((book, index) => (
                      <tr key={book.documentId}>
                        <td>
                          <Rank>{String(index + 1).padStart(2, "0")}</Rank>
                        </td>
                        <td>
                          <BookLink
                            to={`/content-manager/collection-types/api::book.book/${book.documentId}`}
                          >
                            {book.title}
                          </BookLink>
                          <BookCategory>
                            {book.categories.join(" · ")}
                          </BookCategory>
                        </td>
                        <td>{formatNumber(book.engagement)}</td>
                        <td>{formatNumber(book.views)}</td>
                        <td>{formatNumber(book.audioPlays)}</td>
                        <td>{formatNumber(book.bookOpens)}</td>
                        <td>{formatNumber(book.downloads)}</td>
                      </tr>
                    ))}
                  </tbody>
                </BooksTable>
              </TableWrap>
            ) : (
              <EmptyState>Engagement will appear after books are published.</EmptyState>
            )}
          </BooksPanel>

          <OpportunityPanel $delay={290}>
            <SectionTitle>
              <h2>Discovery gaps</h2>
              <span>Views without follow-through</span>
            </SectionTitle>
            {data.opportunities.length ? (
              <OpportunityList>
                {data.opportunities.map((book, index) => (
                  <OpportunityItem key={book.documentId}>
                    <OpportunityRank>
                      {String(index + 1).padStart(2, "0")}
                    </OpportunityRank>
                    <div>
                      <BookLink
                        to={`/content-manager/collection-types/api::book.book/${book.documentId}`}
                      >
                        {book.title}
                      </BookLink>
                      <BookCategory>{book.categories.join(" · ")}</BookCategory>
                    </div>
                    <OpportunityMetric>
                      <strong>{book.depthRate}%</strong>
                      <span>follow-through</span>
                    </OpportunityMetric>
                  </OpportunityItem>
                ))}
              </OpportunityList>
            ) : (
              <EmptyState>Views are needed before opportunities can be ranked.</EmptyState>
            )}
            <FinePrint>
              Ranked by visibility relative to plays, opens, and downloads—not a
              session funnel.
            </FinePrint>
          </OpportunityPanel>
        </Grid>
      </Content>
    </PageCanvas>
  );
};

const Dashboard = () => (
  <Page.Protect permissions={pluginPermissions.readDashboard}>
    <DashboardContent />
  </Page.Protect>
);

export default Dashboard;
