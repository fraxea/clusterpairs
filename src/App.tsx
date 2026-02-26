import { useEffect, useMemo, useState } from 'react'
import sampleResults from './data/sample_results.json'

type MethodKey = 'CellSpectra' | 'GSEA' | 'ORA'

interface DrugData {
  n_ref_clusters: number
  n_qry_clusters: number
  scores: number[]
  CellSpectra: number[][]
  GSEA: number[][]
  ORA: number[][]
}

interface ResultsData {
  pathways: string[]
  drugs: Record<string, DrugData>
}

interface RankedPathway {
  index: number
  name: string
}

type Route =
  | { type: 'home' }
  | { type: 'search' }
  | { type: 'drug'; drugName: string }

const results = sampleResults as ResultsData
const drugNames = Object.keys(results.drugs).sort((a, b) => a.localeCompare(b))
const drugNameSet = new Set(drugNames)

const methods: ReadonlyArray<{ key: MethodKey; label: string; colorClass: string }> = [
  { key: 'CellSpectra', label: 'CellSpectra', colorClass: 'bg-emerald-500' },
  { key: 'GSEA', label: 'GSEA', colorClass: 'bg-blue-500' },
  { key: 'ORA', label: 'ORA', colorClass: 'bg-red-500' },
]

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min
  }

  if (value > max) {
    return max
  }

  return value
}

const formatNumber = (value: number): string => {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return value.toFixed(2).replace(/\.?0+$/, '')
}

const parseRouteFromHash = (hash: string): Route => {
  const route = hash.replace(/^#\/?/, '')
  if (route === 'search') {
    return { type: 'search' }
  }

  if (!route.startsWith('drug/')) {
    return { type: 'home' }
  }

  const encodedDrugName = route.slice('drug/'.length)
  if (!encodedDrugName) {
    return { type: 'home' }
  }

  try {
    const decodedDrugName = decodeURIComponent(encodedDrugName)
    if (drugNameSet.has(decodedDrugName)) {
      return { type: 'drug', drugName: decodedDrugName }
    }

    return { type: 'home' }
  } catch {
    return { type: 'home' }
  }
}

const getMethodTotal = (drug: DrugData, method: MethodKey, pathwayIndices: number[]): number => {
  let total = 0
  for (let clusterIndex = 0; clusterIndex < drug.n_qry_clusters; clusterIndex += 1) {
    for (const pathwayIndex of pathwayIndices) {
      total += drug[method][clusterIndex]?.[pathwayIndex] ?? 0
    }
  }

  return total
}

interface HomePageProps {
  allDrugNames: string[]
}

const HomePage = ({ allDrugNames }: HomePageProps) => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Drug Pathway Explorer</h1>
            <p className="mt-2 text-sm text-slate-600">
              Select a drug to view top upregulated pathways and cluster-level method scores.
            </p>
          </div>

          <a
            href="#/search"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500"
          >
            Search Multi-Pathways
          </a>
        </div>

        <section className="mt-8 grid grid-cols-2 gap-4">
          {allDrugNames.map((drugName) => (
            <a
              key={drugName}
              href={`#/drug/${encodeURIComponent(drugName)}`}
              className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-500 hover:shadow"
            >
              {drugName}
            </a>
          ))}
        </section>
      </main>
    </div>
  )
}

interface DrugDetailPageProps {
  drugName: string
  data: ResultsData
}

const DrugDetailPage = ({ drugName, data }: DrugDetailPageProps) => {
  const selectedDrug = data.drugs[drugName]
  const pathwayCount = Math.min(data.pathways.length, selectedDrug.scores.length)
  const topPathways: RankedPathway[] = Array.from({ length: pathwayCount }, (_, index) => ({
    index,
    score: selectedDrug.scores[index] ?? 0,
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(10, pathwayCount))
    .map(({ index }) => ({
      index,
      name: data.pathways[index] ?? `Pathway ${index}`,
    }))

  const queryClusterIndices = Array.from({ length: selectedDrug.n_qry_clusters }, (_, index) => index)
  const maxReferenceClusters = selectedDrug.n_ref_clusters > 0 ? selectedDrug.n_ref_clusters : 1

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-7xl px-4 py-8">
        <a
          href="#/"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500"
        >
          Back
        </a>

        <h1 className="mt-5 text-2xl font-semibold">
          Top 10 Upregulated Pathways in {drugName} Clusters
        </h1>

        <section className="mt-5 overflow-x-auto rounded-xl border border-slate-300 bg-white shadow-sm">
          <table className="min-w-full border-separate border-spacing-0">
            <tbody>
              {topPathways.map((pathway) => (
                <tr key={pathway.index} className="align-top">
                  <th
                    scope="row"
                    className="w-72 min-w-72 border-b border-slate-200 bg-slate-50 px-3 py-3 text-left text-sm font-medium text-slate-700"
                  >
                    {pathway.name}
                  </th>

                  {queryClusterIndices.map((clusterIndex) => (
                    <td
                      key={`${pathway.index}-${clusterIndex}`}
                      className="min-w-32 border-b border-l border-slate-200 px-3 py-3"
                    >
                      <div className="space-y-1.5">
                        {methods.map((method) => {
                          const value = selectedDrug[method.key][clusterIndex]?.[pathway.index] ?? 0
                          const widthPercent = clamp((value / maxReferenceClusters) * 100, 0, 100)

                          return (
                            <div key={method.key} className="h-3 rounded bg-slate-200">
                              <div
                                title={`${method.label}: ${value}`}
                                className={`h-full rounded ${method.colorClass}`}
                                style={{
                                  width: `${widthPercent}%`,
                                  minWidth: value > 0 ? '2px' : undefined,
                                }}
                              />
                            </div>
                          )
                        })}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr className="bg-white">
                <th
                  scope="col"
                  className="w-72 min-w-72 border-t border-slate-300 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Query Cluster
                </th>

                {queryClusterIndices.map((clusterIndex) => (
                  <th
                    key={`cluster-${clusterIndex}`}
                    scope="col"
                    className="min-w-32 border-l border-t border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700"
                  >
                    {clusterIndex}
                  </th>
                ))}
              </tr>
            </tfoot>
          </table>
        </section>

        <aside className="mt-5 rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Color Guide</h2>

          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
            {methods.map((method) => (
              <div key={`legend-${method.key}`} className="flex items-center gap-2">
                <span className={`h-3 w-6 rounded ${method.colorClass}`} />
                <span>{method.label}</span>
              </div>
            ))}
          </div>

          <p className="mt-4 text-sm text-slate-700">
            Drug clusters: <span className="font-semibold">{selectedDrug.n_qry_clusters}</span>
          </p>
          <p className="text-sm text-slate-700">
            Reference clusters: <span className="font-semibold">{selectedDrug.n_ref_clusters}</span>
          </p>
        </aside>
      </main>
    </div>
  )
}

interface SearchPageProps {
  data: ResultsData
}

const SearchPage = ({ data }: SearchPageProps) => {
  const [query, setQuery] = useState('')
  const [selectedPathways, setSelectedPathways] = useState<string[]>([])

  const pathwayToIndex = useMemo(
    () => new Map(data.pathways.map((pathwayName, pathwayIndex) => [pathwayName, pathwayIndex])),
    [data.pathways],
  )

  const selectedSet = useMemo(() => new Set(selectedPathways), [selectedPathways])
  const normalizedQuery = query.trim().toLowerCase()

  const suggestions = useMemo(() => {
    if (normalizedQuery.length === 0) {
      return data.pathways.filter((pathwayName) => !selectedSet.has(pathwayName)).slice(0, 10)
    }

    return data.pathways
      .filter(
        (pathwayName) =>
          !selectedSet.has(pathwayName) && pathwayName.toLowerCase().includes(normalizedQuery),
      )
      .slice(0, 10)
  }, [data.pathways, normalizedQuery, selectedSet])

  const selectedPathwayIndices = useMemo(
    () =>
      selectedPathways
        .map((pathwayName) => pathwayToIndex.get(pathwayName))
        .filter((pathwayIndex): pathwayIndex is number => pathwayIndex !== undefined),
    [pathwayToIndex, selectedPathways],
  )

  const rankedDrugs = useMemo(() => {
    if (selectedPathwayIndices.length === 0) {
      return []
    }

    return Object.entries(data.drugs)
      .map(([drugName, drug]) => {
        const cumulativeScore = selectedPathwayIndices.reduce(
          (total, pathwayIndex) => total + (drug.scores[pathwayIndex] ?? 0),
          0,
        )

        return {
          drugName,
          cumulativeScore,
          methodTotals: {
            CellSpectra: getMethodTotal(drug, 'CellSpectra', selectedPathwayIndices),
            GSEA: getMethodTotal(drug, 'GSEA', selectedPathwayIndices),
            ORA: getMethodTotal(drug, 'ORA', selectedPathwayIndices),
          },
        }
      })
      .sort((a, b) => b.cumulativeScore - a.cumulativeScore || a.drugName.localeCompare(b.drugName))
      .slice(0, 20)
  }, [data.drugs, selectedPathwayIndices])

  const maxMethodTotal = useMemo(() => {
    const allMethodTotals = rankedDrugs.flatMap((drug) =>
      methods.map((method) => drug.methodTotals[method.key]),
    )

    return Math.max(1, ...allMethodTotals)
  }, [rankedDrugs])

  const addPathway = (pathwayName: string) => {
    if (selectedSet.has(pathwayName)) {
      return
    }

    setSelectedPathways((previous) => [...previous, pathwayName])
    setQuery('')
  }

  const removePathway = (pathwayName: string) => {
    setSelectedPathways((previous) => previous.filter((name) => name !== pathwayName))
  }

  const onSubmitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const exactPathwayMatch = data.pathways.find(
      (pathwayName) => pathwayName.toLowerCase() === query.trim().toLowerCase(),
    )

    if (exactPathwayMatch) {
      addPathway(exactPathwayMatch)
      return
    }

    if (suggestions[0]) {
      addPathway(suggestions[0])
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-7xl px-4 py-8">
        <a
          href="#/"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500"
        >
          Back
        </a>

        <h1 className="mt-5 text-2xl font-semibold">Most Related Drugs to Multi-Pathways</h1>

        <section className="mt-5 rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Search and Add Pathways</h2>

          <form onSubmit={onSubmitSearch} className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pathways..."
              className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
            />
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500"
            >
              Add
            </button>
          </form>

          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggestions</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.length > 0 ? (
                suggestions.map((pathwayName) => (
                  <button
                    key={`suggestion-${pathwayName}`}
                    type="button"
                    onClick={() => addPathway(pathwayName)}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:border-slate-500"
                  >
                    {pathwayName}
                  </button>
                ))
              ) : (
                <span className="text-sm text-slate-500">No matching pathways.</span>
              )}
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Selected Pathways
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedPathways.length > 0 ? (
                selectedPathways.map((pathwayName) => (
                  <span
                    key={`selected-${pathwayName}`}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                  >
                    {pathwayName}
                    <button
                      type="button"
                      onClick={() => removePathway(pathwayName)}
                      className="rounded-full border border-slate-400 px-1 text-[10px] leading-none hover:border-slate-600"
                      title={`Remove ${pathwayName}`}
                    >
                      x
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500">No pathways selected yet.</span>
              )}
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Drug Ranking and Method Totals</h2>
          <p className="mt-1 text-sm text-slate-600">
            Ranked by cumulative score across selected pathways (top 20 drugs).
          </p>

          {selectedPathwayIndices.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">
              Add one or more pathways to view related drugs.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {rankedDrugs.map((drugResult, drugRank) => (
                <article
                  key={`search-result-${drugResult.drugName}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">
                      #{drugRank + 1} {drugResult.drugName}
                    </h3>
                    <p className="text-sm text-slate-700">
                      Cumulative Score: <span className="font-semibold">{formatNumber(drugResult.cumulativeScore)}</span>
                    </p>
                  </div>

                  <div className="mt-3 space-y-2">
                    {methods.map((method) => {
                      const total = drugResult.methodTotals[method.key]
                      const widthPercent = clamp((total / maxMethodTotal) * 100, 0, 100)

                      return (
                        <div key={`${drugResult.drugName}-${method.key}`} className="grid grid-cols-[90px_1fr_auto] items-center gap-2">
                          <span className="text-xs font-medium text-slate-700">{method.label}</span>
                          <div className="h-4 rounded bg-slate-200">
                            <div
                              title={`${method.label}: ${formatNumber(total)}`}
                              className={`h-full rounded ${method.colorClass}`}
                              style={{
                                width: `${widthPercent}%`,
                                minWidth: total > 0 ? '2px' : undefined,
                              }}
                            />
                          </div>
                          <span className="text-xs font-semibold tabular-nums text-slate-700">
                            {formatNumber(total)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function App() {
  const [route, setRoute] = useState<Route>(() => parseRouteFromHash(window.location.hash))

  useEffect(() => {
    const syncFromHash = () => {
      setRoute(parseRouteFromHash(window.location.hash))
    }

    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)

    return () => {
      window.removeEventListener('hashchange', syncFromHash)
    }
  }, [])

  if (route.type === 'search') {
    return <SearchPage data={results} />
  }

  if (route.type === 'drug') {
    return <DrugDetailPage drugName={route.drugName} data={results} />
  }

  return <HomePage allDrugNames={drugNames} />
}

export default App
