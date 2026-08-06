import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Page, useFetchClient } from "@strapi/strapi/admin";
import styled, { keyframes } from "styled-components";

import pluginPermissions from "../permissions";

const METRICS = [
  { key: "views", label: "Views", short: "V", color: "#b9f45d" },
  { key: "audioPlays", label: "Audio plays", short: "A", color: "#ff9f7a" },
  { key: "bookOpens", label: "Book opens", short: "O", color: "#8cc8ff" },
  { key: "downloads", label: "Downloads", short: "D", color: "#e2b6ff" },
];

const HEALTH_ROWS = [
  { key: "withCategory", label: "Categorized" },
  { key: "withAuthors", label: "Author attached" },
  { key: "withTags", label: "Tagged" },
  { key: "withEnglishDescription", label: "English summary" },
  { key: "withEbook", label: "eBook attached" },
  { key: "withAudio", label: "Audio available" },
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
  --ink: #111a2c;
  --panel: #18243a;
  --panel-soft: #1c2a43;
  --line: rgba(232, 240, 255, 0.12);
  --muted: #9dacbf;
  --text: #f5f7ef;
  --acid: #b9f45d;
  --coral: #ff9f7a;
  min-height: 100%;
  padding: clamp(24px, 4vw, 56px);
  color: var(--text);
  background:
    radial-gradient(circle at 86% 8%, rgba(185, 244, 93, 0.11), transparent 25rem),
    radial-gradient(circle at 10% 45%, rgba(140, 200, 255, 0.08), transparent 30rem),
    var(--ink);
  position: relative;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.18;
    background-image: radial-gradient(rgba(255, 255, 255, 0.22) 0.7px, transparent 0.7px);
    background-size: 18px 18px;
    mask-image: linear-gradient(to bottom, black, transparent 72%);
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
  margin-bottom: 32px;
  animation: ${reveal} 420ms ease both;

  @media (max-width: 700px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

const Eyebrow = styled.p`
  margin: 0 0 12px;
  color: var(--acid);
  font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.16em;
  text-transform: uppercase;
`;

const Title = styled.h1`
  max-width: 720px;
  margin: 0;
  font: 500 clamp(38px, 5.3vw, 76px)/0.95 Georgia, "Times New Roman", serif;
  letter-spacing: -0.045em;
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
  border-radius: 99px;
  color: var(--muted);
  background: rgba(24, 36, 58, 0.72);
  font: 650 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  &::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--acid);
    box-shadow: 0 0 12px rgba(185, 244, 93, 0.8);
    animation: ${pulse} 1.8s ease-in-out infinite;
  }
`;

const RefreshButton = styled.button`
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid var(--acid);
  border-radius: 99px;
  color: var(--ink);
  background: var(--acid);
  cursor: pointer;
  font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: transform 160ms ease, box-shadow 160ms ease;

  &:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 9px 24px rgba(185, 244, 93, 0.18);
  }

  &:focus-visible {
    outline: 3px solid rgba(140, 200, 255, 0.65);
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
  gap: 16px;
  margin-bottom: 16px;
`;

const Panel = styled.article`
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(24, 36, 58, 0.88);
  box-shadow: 0 18px 50px rgba(2, 8, 20, 0.18);
  backdrop-filter: blur(18px);
  animation: ${reveal} 500ms ease both;
  animation-delay: ${({ $delay = 0 }) => `${$delay}ms`};
`;

const HeroMetric = styled(Panel)`
  grid-column: span 4;
  min-height: 290px;
  padding: 26px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background:
    linear-gradient(148deg, rgba(185, 244, 93, 0.14), transparent 55%),
    rgba(24, 36, 58, 0.94);

  @media (max-width: 980px) {
    grid-column: span 12;
  }
`;

const MetricDeck = styled.div`
  grid-column: span 8;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;

  @media (max-width: 980px) {
    grid-column: span 12;
  }

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const MetricCard = styled(Panel)`
  min-height: 137px;
  padding: 20px;
  position: relative;
  overflow: hidden;

  &::after {
    content: "${({ $mark }) => $mark}";
    position: absolute;
    right: -2px;
    bottom: -24px;
    color: ${({ $color }) => $color};
    opacity: 0.07;
    font: 800 106px/1 Georgia, serif;
  }
`;

const Label = styled.p`
  margin: 0;
  color: var(--muted);
  font: 700 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.09em;
  text-transform: uppercase;
`;

const HeroNumber = styled.p`
  margin: 10px 0;
  font: 500 clamp(46px, 5.2vw, 72px)/1 Georgia, serif;
  letter-spacing: -0.045em;
`;

const MetricNumber = styled.p`
  margin: 16px 0 0;
  font: 520 clamp(30px, 3vw, 42px)/1 Georgia, serif;
  letter-spacing: -0.035em;
`;

const FinePrint = styled.p`
  margin: 0;
  max-width: 39ch;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
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
  gap: 16px;
  margin-bottom: 22px;

  h2 {
    margin: 0;
    font: 500 25px/1.1 Georgia, serif;
    letter-spacing: -0.025em;
  }

  span {
    color: var(--muted);
    font: 650 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
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
  background: linear-gradient(90deg, var(--acid), #d8ff9c);
  transform-origin: left;
  animation: ${reveal} 680ms ease both;
`;

const MonoValue = styled.span`
  color: var(--muted);
  font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
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
    font: 500 22px/1.1 Georgia, serif;
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
  font: 500 30px/1 Georgia, serif;
`;

const BooksPanel = styled(Panel)`
  grid-column: span 8;
  padding: 25px;
  overflow: hidden;

  @media (max-width: 1100px) {
    grid-column: span 12;
  }
`;

const ActivityPanel = styled(Panel)`
  grid-column: span 4;
  padding: 25px;

  @media (max-width: 1100px) {
    grid-column: span 12;
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
    font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
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
    font: 650 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
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
  font: 550 14px/1.25 Georgia, serif;
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
  font: 650 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const ActivityList = styled.ul`
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const ActivityItem = styled.li`
  display: grid;
  grid-template-columns: 10px 1fr;
  gap: 13px;
  padding: 14px 0;
  border-top: 1px solid var(--line);

  &:first-child {
    padding-top: 0;
    border-top: 0;
  }
`;

const ActivityDot = styled.span`
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border: 2px solid var(--panel);
  border-radius: 50%;
  background: var(--coral);
  box-shadow: 0 0 0 1px var(--coral);
`;

const ActivityTitle = styled.p`
  margin: 0 0 5px;
  color: var(--text);
  font: 540 14px/1.25 Georgia, serif;
`;

const ActivityMeta = styled.p`
  margin: 0;
  color: var(--muted);
  font: 650 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
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
    font: 500 23px/1 Georgia, serif;
  }

  span {
    color: var(--muted);
    font: 650 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
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
    font: 500 34px/1 Georgia, serif;
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
  const strongestCategory = data.categories[0]?.engagement || 0;

  return (
    <PageCanvas>
      <Content>
        <Header>
          <div>
            <Eyebrow>Library signal desk / lifetime</Eyebrow>
            <Title>Catalog intelligence.</Title>
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
          <HeroMetric $delay={40}>
            <div>
              <Label>Total engagement</Label>
              <HeroNumber title={formatExact(data.totals.engagement)}>
                {formatNumber(data.totals.engagement)}
              </HeroNumber>
              <FinePrint>
                Every view, play, open, and download currently stored on published books.
              </FinePrint>
            </div>
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
              <FinePrint>
                Lifetime counters are directional. They do not yet provide a dated trend.
              </FinePrint>
            </div>
          </HeroMetric>

          <MetricDeck>
            {composition.map((metric, index) => (
              <MetricCard
                key={metric.key}
                $delay={80 + index * 45}
                $mark={metric.short}
                $color={metric.color}
              >
                <Label>{metric.label}</Label>
                <MetricNumber title={formatExact(metric.value)}>
                  {formatNumber(metric.value)}
                </MetricNumber>
              </MetricCard>
            ))}
          </MetricDeck>
        </Grid>

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

        <Grid>
          <CategoryPanel $delay={170}>
            <SectionTitle>
              <h2>Category pull</h2>
              <span>Ranked by engagement</span>
            </SectionTitle>
            {data.categories.length ? (
              <CategoryList>
                {data.categories.map((category) => (
                  <CategoryRow key={category.name}>
                    <span>{category.name}</span>
                    <BarTrack>
                      <BarFill
                        $width={safePercent(category.engagement, strongestCategory)}
                      />
                    </BarTrack>
                    <MonoValue>
                      {formatNumber(category.engagement)} · {category.books} books
                    </MonoValue>
                  </CategoryRow>
                ))}
              </CategoryList>
            ) : (
              <EmptyState>Publish categorized books to see this ranking.</EmptyState>
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
          <BooksPanel $delay={250}>
            <SectionTitle>
              <h2>Books carrying the catalog</h2>
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
                          <BookCategory>{book.category}</BookCategory>
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

          <ActivityPanel $delay={290}>
            <SectionTitle>
              <h2>Recently touched</h2>
              <span>Published books</span>
            </SectionTitle>
            {data.recentlyUpdated.length ? (
              <ActivityList>
                {data.recentlyUpdated.map((book) => (
                  <ActivityItem key={book.documentId}>
                    <ActivityDot />
                    <div>
                      <ActivityTitle>{book.title}</ActivityTitle>
                      <ActivityMeta>
                        {formatDate(book.updatedAt)} · {book.category}
                      </ActivityMeta>
                    </div>
                  </ActivityItem>
                ))}
              </ActivityList>
            ) : (
              <EmptyState>No published updates yet.</EmptyState>
            )}
            <Inventory>
              <InventoryItem>
                <strong>{data.totals.publishedBooks}</strong>
                <span>Published</span>
              </InventoryItem>
              <InventoryItem>
                <strong>{data.totals.unpublishedBooks}</strong>
                <span>Unpublished</span>
              </InventoryItem>
              <InventoryItem>
                <strong>{data.contentHealth.featured}</strong>
                <span>Featured</span>
              </InventoryItem>
              <InventoryItem>
                <strong>{data.contentHealth.newArrivals}</strong>
                <span>New</span>
              </InventoryItem>
            </Inventory>
          </ActivityPanel>
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
