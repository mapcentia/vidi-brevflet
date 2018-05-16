'use strict';

require('leaflet.markercluster');

/**
 *
 * @type {*|exports|module.exports}
 */
var cloud;

/**
 *
 * @type {*|exports|module.exports}
 */
var utils;

/**
 *
 * @type {*|exports|module.exports}
 */
var backboneEvents;

/**
 *
 * @type {string}
 */
var exId = "brevflet";

/**
 *
 * @type {L.FeatureGroup}
 */
var drawnItems = new L.FeatureGroup();

/**
 *
 * @type {L.FeatureGroup}
 */
var markers = L.markerClusterGroup({
    disableClusteringAtZoom: 18
});

/**
 * @type {*|exports|module.exports}
 */
var drawControl;

/**
 *
 */
var mapObj;

/**
 *
 */
var transformPoint;

/**
 *
 * @type {{set: module.exports.set, init: module.exports.init}}
 */

module.exports = module.exports = {
    /**
     *
     * @param o
     * @returns {exports}
     */
    set: function (o) {
        cloud = o.cloud;
        utils = o.utils;
        transformPoint = o.transformPoint;
        backboneEvents = o.backboneEvents;
        return this;
    },

    init: function () {

        mapObj = cloud.get().map;

        var React = require('react');
        var ReactDOM = require('react-dom');

        class BrevFlet extends React.Component {
            
            constructor(props) {
                super(props);

                let self = this
                backboneEvents.get().on("reset:all", function () {
                    //If component is active, reset it
                    if (self.state.active) {
                        self.onActive(false);
                    }
                });

                this.state = {
                    active: false,
                    data: []
                };
            }

            onActive(checked) {
                this.setState({
                    active: checked
                });

                if (checked) {
                    backboneEvents.get().trigger("reset:all");
                    mapObj.addControl(drawControl);
                    mapObj.on('draw:created', (e) => this.polygonCreated(e));
                    mapObj.on('draw:edited', (e) => this.polygonChanged(e));
                    mapObj.on('draw:deletestop', (e) => this.polygonChanged(e));
                } else {
                    drawnItems.clearLayers();
                    markers.clearLayers();
                    mapObj.removeControl(drawControl);
                    mapObj.off('draw:created');
                    mapObj.off('draw:edited');
                    mapObj.off('draw:deletestop');
                }
            }

            componentDidMount() {

                drawControl = new L.Control.Draw({
                    position: 'topright',
                    draw: {
                        polygon: {
                            title: 'tegn et polygon!',
                            allowIntersection: true,
                            shapeOptions: {
                                color: '#ff0000'
                            },
                            showArea: true
                        },
                        circle: {
                            title: 'tegn en cirkel',
                            shapeOptions: {
                                color: '#ff0000'
                            }
                        },
                        rectangle: false,
                        marker: false,
                        polyline: false,
                        circlemarker: false
                    },
                    edit: {
                        featureGroup: drawnItems
                    }
                });

                drawControl.setDrawingOptions({
                    polygon: {
                        icon: cloud.iconSmall
                    },
                    circle: {
                        icon: cloud.iconSmall
                    }
                });

                mapObj.addControl(drawnItems);
            }

            polygonCreated(e) {
                //Draw the selected polygon on the drawnItems layer
                e.layer.setStyle({ className: 'brevflet' });
                drawnItems.addLayer(e.layer);

                //Generate a sql statement for the sql api
                let sql = this.generateSqlUrl();
                let url = 'http://gc2.frederiksberg.dk/api/v2/sql/frederiksberg?q=' + sql;

                //Query the sql api
                $.ajax({
                    url: url,
                    dataType: 'json',
                    success: (data) => this.sqlQueryComplete(data)
                });
            }

            polygonChanged(e) {
                let sql = this.generateSqlUrl();
                let url = 'http://gc2.frederiksberg.dk/api/v2/sql/frederiksberg?q=' + sql;

                //If nothing is selected
                if (sql === '') {
                    this.sqlQueryComplete([]);
                } else {
                    $.ajax({
                        url: url,
                        dataType: 'json',
                        success: (data) => this.sqlQueryComplete(data)
                    });
                }
            }

            generateSqlUrl() {

                //If there are no drawn items
                if (drawnItems.getLayers().length === 0) {
                    return "";
                }

                let layers = []

                //Convert each polygon into geoJson
                drawnItems.eachLayer(layer => {
                    let newLayer = layer.toGeoJSON();

                    //If the polygon is a circle, add its radius to its properties
                    if (newLayer.geometry.type === 'Point')
                        newLayer.properties.radius = layer.getRadius();

                    layers.push(newLayer);
                });

                let whereClauses = []

                for (let i = 0; i < layers.length; i++) {
                    let geoJson = layers[i];
                    let convertPolygonSql;

                    switch (geoJson.geometry.type) {
                        case 'Point':
                            convertPolygonSql = "st_buffer(st_transform(st_SetSrid(st_geomfromGeoJson('" + JSON.stringify(geoJson.geometry) + "'),4326),25832)," + geoJson.properties.radius + ")";
                            break;
                        case 'Polygon':
                            convertPolygonSql = "st_transform(st_SetSrid(st_geomfromGeoJson('" + JSON.stringify(geoJson.geometry) + "'),4326),25832)";
                            break;
                    }

                    whereClauses.push(" st_contains(" + convertPolygonSql + ",the_geom)");

                }
                return "SELECT ST_X(St_transform(the_geom,4326)) as lng,ST_Y(St_transform(the_geom,4326)) as lat," +
                    "kommunekode,vejkode,husnr,vejnavn FROM grundkort.adgangsadresser where" + whereClauses.join(" OR ");
            }

            sqlQueryComplete(data) {
                this.setState({
                    active: this.state.active,
                    data: data.features || []
                })

                markers.clearLayers();
                mapObj.addLayer(markers);

                let markerData = this.state.data;

                //Draw a marker for each selected point
                for (let i = 0; i < markerData.length; i++) {
                    let feature = markerData[i];

                    let name = feature.properties.vejnavn + ' ' + feature.properties.husnr;
                    //Remove spaces and ' chars
                    let concatedName = name.replace(/[^A-Z0-9]+/ig, '');

                    let icon = new L.DivIcon({
                        className: 'brevflet-marker ' + 'brevflet-marker-' + concatedName,
                        html: feature.properties.husnr,
                    })

                    L.marker([feature.properties.lat, feature.properties.lng], {
                        icon: icon,
                        title: feature.properties.vejnavn + " " + feature.properties.husnr
                    })
                    .addTo(markers);
                }
            }

            onSendToExplorer(e) {

                if (this.state.data.length <= 0) {
                    alert("Ingen addresser valgt. Vælg addresser først");
                    return;
                }

                let municipalitycode = [];
                let streetcode = [];
                let housecode = [];

                this.state.data.map(x => {
                    municipalitycode.push(x.properties.kommunekode)
                    streetcode.push(x.properties.vejkode)
                    housecode.push(x.properties.husnr)
                });

                let search_params = 'municipalitycode=' + municipalitycode.join(',') + '&streetcode=' + streetcode.join(',') + '&housecode=' + housecode.join(',');
                let data = escape(search_params);

                let url = 'http://www.kortviser.dk/UsersPublic/Handlers/LIFAExternalIntegrationServiceREST.ashx';

                $.ajax({
                    url: url,
                    method: 'POST',
                    data: data,
                    dataType: 'json',
                    success: function (data) {
                        let ejdexpl_url = 'ejdexpl://?mode=merge&LIFAExternalIntegrationServiceID=' + data.lifaexternalintegrationserviceid;
                        window.open(ejdexpl_url, '_self');
                    }
                });
            }

            onRemoveItem(e, index, nameToFind) {
                let layerToRemove;
                markers.eachLayer((layer) => {
                    let geoJson = layer.toGeoJSON();
                    if (layer.options.title === nameToFind) {
                        layerToRemove = layer;
                    }
                });

                markers.removeLayer(layerToRemove);

                let data = this.state.data;
                data.splice(index, 1);

                this.setState({
                    active: this.state.active,
                    data: data
                })
            }

            itemMouseEnter(e, nameToHighlight) {
                $('.brevflet-marker-' + nameToHighlight).addClass('active');
            }

            itemMouseLeave(e, nameToHighlight) {
                $('.brevflet-marker-' + nameToHighlight).removeClass('active');
            }

            render() {

                let listData = this.state.data.slice();

                if (listData.length >= 100) {
                    listData.splice(100, listData.length - 100);
                }

                let selected = listData.map((x, index) => {
                    let name = x.properties.vejnavn + ' ' + x.properties.husnr;
                    let concatedName = name.replace(/[^A-Z0-9]+/ig, '');

                    return (
                        <li key={index}
                            onMouseEnter={(e) => this.itemMouseEnter(e, concatedName)}
                            onMouseLeave={(e) => this.itemMouseLeave(e, concatedName)}
                            className="list-group-item address">
                            {name}
                            <span onClick={(e) => this.onRemoveItem(e, index, name)} className="glyphicon glyphicon-remove-circle remove-icon"></span>
                        </li>
                    );
                })

                return (

                    <div role="tabpanel brevflet">
                        <div className="panel panel-default">
                            <div className="panel-body">
                                <div className="form-group">
                                    
                                    <div className="togglebutton">
                                        <label><input id="brevflet-btn" type="checkbox"
                                            checked={this.state.active}
                                            onChange={(e) => this.onActive(e.target.checked)} />{__("Activate")}
                                        </label>
                                    </div>

                                    <div className="btn-container" style={{ textAlign: 'center' }} >
                                        <button className="btn btn-primary" onClick={(e) => this.onSendToExplorer(e)}>Send til Ejd Explorer</button>
                                    </div>

                                </div>

                                <div className="selected-addresses">
                                    Valgte Addresser: {this.state.data.length}
                                </div>

                                <div className="list" style={this.marginBottomXl}>
                                    <ul className="list-group">
                                        {selected}
                                    </ul>
                                </div>

                            </div>
                        </div>
                    </div>
                );
            }
        }

        utils.createMainTab(exId, "Brevflet", "Dette komponent kræver at ejd explorer er installeret. Vælg addresser til brug i Edj Explorer. Vælg ved at tegne med tegne værktøjet i kortet. (Der kan maks vises 100 addresser i menuen)", require('./../../../browser/modules/height')().max);

        // Append to DOM
        //==============
        try {
            ReactDOM.render(
                <BrevFlet />,
                document.getElementById(exId)
            );
        } catch (e) {

        }

    }
};