
const { HashRouter, Switch, Route } = ReactRouterDOM


class Main extends React.Component {
    render() {
        return (
            <HashRouter>
                <Switch>
                  <Route exact path="/" component={Home} />
                  <Route path="/select" component={Select} />
                  <Route path="/create/:id" component={Create} />
                  <Route path="/edit/:id" component={Edit} />
                </Switch>
            </HashRouter>
        )
    }
}

class Select extends React.Component {
    constructor(props) {
        super(props)
        this.state = {
            activities:[],
            year: new Date().getFullYear(),
            month: new Date().getMonth()
        }
    }
    async componentDidMount() {
        this.componentDidUpdate({},{})

        //this.setState({data: data, map: dataMap})
    }
    async componentDidUpdate(prevProps, prevState) {
        if (this.state.year !== prevState.year || this.state.month !== prevState.month) {
            const acts = await axios.get(`//api.dev.routereport.cf/strava/selection?year=${this.state.year}&month=${this.state.month}`, { withCredentials: true })
            this.setState({ activities: acts.data })
        }
    }

    createReport(activity) {
        console.log('create', activity)
        location.href = '#/create/' + activity.id
    }
    
    render() {
        return (
            <div>
                <h1>Select activity:</h1>
                <div>
                  <a href="javascript: void(0);" onClick={() => this.setState({ year: this.state.year - 1, activities:[] })}>{'<<'}</a>
                  <span className="year">{ this.state.year }</span>
                  <a href="javascript: void(0);" onClick={() => this.setState({ year: this.state.year + 1, activities:[] })}>{'>>'}</a>
                </div>

                <div className="months">
                { Array.from({ length: 12}).map((und, month) => {
                   return month !== this.state.month ?
                      (<a key={month} href="javascript: void(0);" onClick={() => this.setState({ month, activities:[] })}>{month}</a>) : 
                      <span key={month}>{ month }</span>
                   })
                }
                </div>

                <div>
                {
                    this.state.activities.map(act => {
                        const d = moment(act.start_date_local)
                        const t = Math.round(act.elapsed_time / 60)
                        
                        return (<div key={act.id}>
                                {d.format('Do dddd h:mm')}
                                {act.name}
                                {(act.distance/1000).toPrecision(4) + ' km'}
                                { act.average_heartrate && act.average_heartrate + ' bpm'}
                                {`${Math.floor(t / 60)}h ${t % 60} min`}
                                  <button onClick={()=>this.createReport(act)}>Create report</button>
                                </div>)
                      }
                    )
                }
                </div>
            </div>
        )
    }
}

class Home extends React.Component {
    constructor(props) {
        super(props)
        this.state = {
            data: [],
            map: {}
        }
    }
    async componentDidMount() {
    }
    render() {
        return (
            <div className="content">
                <h1>Welcome to Route Report</h1>
                <p>
                Route Report is Strava application to ease writing
                reports of your activities. With Route Report you can
                write reports where text is bound to your actual route
                activity.
                </p>
                <h2>How does it work?</h2>
                <ol>
                  <li>Select activity from Strava</li>
                  <li>Split the activity to segments of your choice</li>
                  <li>Write a route report by describing each
                      splitted segment of your activity</li>
                </ol>
                <div>
                  <a href="https://www.strava.com/oauth/authorize?client_id=34435&redirect_uri=https://api.dev.routereport.cf/strava/callback&response_type=code">Start!</a>
                </div>
                
                <h2>Pricing</h2>
                <ul>
                  <li>Free - 3 first reports</li>
                  <li>5€ - 15 more reports</li>
                  <li>10€ - 50 more reports</li>
                </ul>
            </div>
        )
    }
}

class Create extends React.Component {
    constructor(props) {
        super(props)
        this.state = {
            id: props.match.params.id
        }
    }
    async componentDidMount() {
        const created = await axios.get(`//api.dev.routereport.cf/strava/create/${this.state.id}`, { withCredentials: true })
        console.log('created', created)
        if (created.data.created)
            location.href = `#/edit/${this.state.id}`
    }

    render() {
        return (
            <div>Create</div>
        )
    }

}

class Edit extends React.Component {
    constructor(props) {
        super(props)
        this.state = {
            id: props.match.params.id
        }
    }
    async componentDidMount() {
        const data = await axios.get(`/activities/${this.state.id}/data.json`, { withCredentials: true })
        const activity = await axios.get(`/activities/${this.state.id}/activity.json`, { withCredentials: true })
        const report = await axios.get(`/activities/${this.state.id}/report.json`, { withCredentials: true })
        if (!report.data.splits) {
            console.log(data.data.map(stream => stream.original_size))
            report.data.splits = [{ start: 0, end: Math.max.apply(null, data.data.map(stream => stream.original_size))}]
        }

        this.setState({ data: data.data, activity: activity.data, report: report.data })
    }

    render() {
        if (this.state.data === undefined)
            return (<div>Loading data..</div>)


        return (
            <div>
            <h1>{this.state.activity.name}</h1>

            {
                this.state.report.splits.map((split, idx) => {
                    return (
                            <SplitCanvas data={this.state.data} split={split} />
                            )
                })
            }
            </div>
        )
    }

}

class SplitCanvas extends React.Component {
    getData(key) {
        const datas = this.props.data.filter(t => t.type===key)
        if (datas.length === 1)
            return datas[0].data
        return null
    }
    componentDidMount() {
        const split = this.props.split

        const canvas = this.refs.canvas
        const freq = Math.floor((split.end - split.start) / canvas.width)
        
        const ctx = canvas.getContext("2d")
        //for (var x = 0.5; x < 800; x += 10) { ctx.moveTo(x, 0); ctx.lineTo(x, 500); } 
        //for (var y = 0.5; y < 500; y += 10) { ctx.moveTo(0, y); ctx.lineTo(800, y); }
        ctx.strokeStyle = "#bbb"
        ctx.stroke()

        const moving = this.getData('moving')
        if (moving) {
            ctx.beginPath()
            ctx.strokeStyle = "#eaa"
            for (var x = 0; x < canvas.width; x += 1) {
                if (!moving[freq * x]) {
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, canvas.height);
                }
            }
            ctx.stroke()
        }

        const alt = this.getData('altitude')
        if (alt) {
            ctx.beginPath()
            ctx.strokeStyle = "#bbb"
            const min = Math.min.apply(null, alt)
            const rel = Math.max.apply(null, alt) - min
            for (var x = 0; x < canvas.width; x += 1) {
                const y = (alt[freq * x] - min) / rel
                ctx.moveTo(x, 50);
                ctx.lineTo(x, 50-(50*y));
            }
            ctx.stroke()
        }
/*
        const velocity = this.getData('velocity_smooth')
        if (velocity) {
            ctx.beginPath()
            ctx.strokeStyle = "#33d"
            ctx.moveTo(0, 50);
            const max = Math.max.apply(null, velocity)
            for (var x = 0; x < canvas.width; x += 1) {
                const y = velocity[freq * x] / max
                ctx.lineTo(x, 50-(50*y));
            }
            ctx.stroke()
        }
        const heartrate = this.getData('heartrate')
        if (heartrate) {
            ctx.beginPath()
            ctx.strokeStyle = "#f00"
            ctx.moveTo(0, 50);
            const max = Math.max.apply(null, heartrate)
            const min = Math.min.apply(null, heartrate)
            for (var x = 0; x < canvas.width; x += 1) {
                const y = (heartrate[freq * x] - min) / (max-min)
                ctx.lineTo(x, 50-(50*y));
            }
            ctx.stroke()
        }
*/

        const map = L.map(this.refs.map)
        L.tileLayer('https://b.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
            maxZoom: 18,
            //accessToken: 'your.mapbox.access.token'
        }).addTo(map)

        const data = this.props.data.filter(t => t.type==='latlng')[0].data

        const polyline = L.polyline(data.slice(split.start, split.end), {color: 'red'}).addTo(map)
        map.fitBounds(polyline.getBounds())
    }
    render(){
        return (
            <div>
                <div ref="map" style={{height: '250px', width: '30%'}}></div>
                <div>
                Select a point below to split the route.
                You may join or resplit afterwards.
                </div>
                <canvas ref="canvas" width={800} height={60}></canvas>
            </div>
        )
    }
}


ReactDOM.render(
  <Main />,
  document.getElementById('root')
)
