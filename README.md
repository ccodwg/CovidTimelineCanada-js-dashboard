# CovidTimelineCanada dashboard

A simple dashboard for exploring the [Timeline of COVID-19 in Canada](https://github.com/ccodwg/CovidTimelineCanada) dataset.

Try the published dashboard at <https://ccodwg.github.io/CovidTimelineCanada-js-dashboard/>.

The dashboard supports Canada, province/territory and health-region series; comparisons between multiple geographies; daily and weekly views; and metadata-driven data notes. The upstream dataset is historical and ends on December 31, 2023, although individual series may end earlier.

## Weekly values

Weeks run from Monday through Sunday and are labelled by the ending Sunday.

- Incident quantities, such as cases and admissions, are summed.
- Cumulative quantities, occupancy and coverage use the final available observation.
- Weekly changes in occupancy and coverage are calculated from consecutive weekly endpoints.
- Explicitly missing incident observations remain missing instead of being treated as zero.

## Local development

No build step or runtime package installation is required. The page loads Bootstrap, Apache ECharts and Papa Parse from CDNs and fetches data directly from the upstream GitHub repository.

Serve the repository with any static web server, for example:

```sh
python -m http.server
```

The pure data and transformation logic is tested with Node's built-in test runner. There are no npm dependencies:

```sh
npm test
```
