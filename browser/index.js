/*
 * @author     brunnernikolaj
 * @copyright  2013-2024 Frederiksberg Kommune
 * @license    http://www.gnu.org/licenses/#AGPL  GNU AFFERO GENERAL PUBLIC LICENSE 3
 */

'use strict';

import React from "react";

let cloud;
let utils;
let backboneEvents;
const MODULE_NAME = "vidi-brevflet";
const drawnItems = new L.FeatureGroup();
const markers = L.markerClusterGroup({
    disableClusteringAtZoom: 18
});

const parcels = L.geoJson(null, {style: {color: '#6ECC39'}, interactive: false});
let drawControl;
let mapObj;
let transformPoint;

import {GEOJSON_PRECISION} from '../../../browser/modules/constants';


module.exports = module.exports = {
    /**
     *
     * @param o
     * @returns {exports}
     */
    set(o) {
        cloud = o.cloud;
        utils = o.utils;
        transformPoint = o.transformPoint;
        backboneEvents = o.backboneEvents;
        return this;
    },
    off() {
        alert("OFF")
    },
    on() {
        alert("ON")
    },
    init() {
        mapObj = cloud.get().map;
        const React = require('react');
        const ReactDOM = require('react-dom');

        class BrevFlet extends React.Component {
            constructor(props) {
                super(props);
                this.state = {
                    active: false,
                    data: [],
                    ejdUrl: null,
                    searchType: "addr"
                };
                this.handleTypeChange = this.handleTypeChange.bind(this);
            }

            componentDidMount() {
                backboneEvents.get().on(`on:${MODULE_NAME}`, () => {
                    backboneEvents.get().trigger("reset:all");
                    mapObj.addControl(drawControl);
                    mapObj.on('draw:created', (e) => this.polygonCreated(e));
                    mapObj.on('draw:edited', (e) => this.polygonChanged(e));
                    mapObj.on('draw:deletestop', (e) => this.polygonChanged(e));
                });
                backboneEvents.get().on(`off:all`, () => {
                    drawnItems.clearLayers();
                    markers.clearLayers();
                    parcels.clearLayers();
                    this.setState({data: []});
                    mapObj.removeControl(drawControl);
                    mapObj.off('draw:created');
                    mapObj.off('draw:edited');
                    mapObj.off('draw:deletestop');
                });
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

            handleTypeChange(event) {
                drawnItems.clearLayers();
                markers.clearLayers();
                parcels.clearLayers();
                this.setState({searchType: event.target.value, data: [], ejdUrl: null});
            };

            polygonCreated(e) {
                //Draw the selected polygon on the drawnItems layer
                e.layer.setStyle({className: 'brevflet'});
                drawnItems.addLayer(e.layer);
                //Generate a sql statement for the sql api
                let sql = this.generateSqlUrl();
                let url = 'https://dk.gc2.io/api/v2/sql/dk?srs=4326&q=' + sql;
                //Query the sql api
                $.ajax({
                    url: url,
                    dataType: 'json',
                    success: (data) => this.sqlQueryComplete(data)
                });
            }

            polygonChanged(e) {
                let sql = this.generateSqlUrl();
                let url = 'https://dk.gc2.io/api/v2/sql/dk?srs=4326&q=' + sql;
                //If nothing is selected
                if (sql === '') {
                    this.sqlQueryComplete([]);
                } else {
                    $.ajax({
                        url: url,
                        dataType: 'json',
                        success: data => this.sqlQueryComplete(data)
                    });
                }
            }

            generateSqlUrl() {
                //If there are no drawn items
                if (drawnItems.getLayers().length === 0) {
                    return;
                }
                let layers = []
                //Convert each polygon into geoJson
                drawnItems.eachLayer(layer => {
                    let newLayer = layer.toGeoJSON(GEOJSON_PRECISION);
                    //If the polygon is a circle, add its radius to its properties
                    if (newLayer.geometry.type === 'Point') {
                        newLayer.properties.radius = layer.getRadius();
                    }
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
                    whereClauses.push(" st_intersects(" + convertPolygonSql + ",the_geom)");
                }
                const addrSql = "SELECT ST_X(St_transform(the_geom,4326)) as lng,ST_Y(St_transform(the_geom,4326)) as lat,kommunekode,vejkode,husnr,vejnavn FROM dar.adgangsadresser_m_vejnavn where" + whereClauses.join(" OR ");
                const matrSql = "SELECT kommunekode,matrikelnummer,ejerlavsnavn,landsejerlavskode,the_geom FROM matrikel.jordstykke where " + whereClauses.join(" OR ");
                return this.state.searchType === 'addr' ? addrSql : matrSql;
            }

            sqlQueryComplete(data) {
                this.setState({
                    active: this.state.active,
                    data: data.features || []
                })
                if (this.state.searchType === 'addr') {
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
                        }).addTo(markers);
                    }
                } else {
                    parcels.clearLayers();
                    mapObj.addLayer(parcels);
                    parcels.addData(data.features)
                }
                this.onSendToExplorer()
            }

            onSendToExplorer() {
                let me = this;
                if (this.state.data.length <= 0) {
                    alert("Ingen addresser valgt. Vælg addresser først");
                    return;
                }
                if (this.state.searchType === 'addr') {
                    let municipalitycode = [];
                    let streetcode = [];
                    let housecode = [];
                    this.state.data.map(x => {
                        municipalitycode.push(x.properties.kommunekode);
                        streetcode.push(x.properties.vejkode);
                        housecode.push(x.properties.husnr);
                    });
                    let searchParams = 'municipalitycode=' + municipalitycode.join(',') + '&streetcode=' + streetcode.join(',') + '&housecode=' + housecode.join(',');
                    let url = '//www.kortviser.dk/UsersPublic/Handlers/LIFAExternalIntegrationServiceREST.ashx';
                    $.ajax({
                        url: url,
                        method: 'POST',
                        data: searchParams,
                        dataType: 'json',
                        success: function (data) {
                            let ejdUrl = 'ejdexpl://?mode=merge&LIFAExternalIntegrationServiceID=' + data.lifaexternalintegrationserviceid;
                            me.setState({ejdUrl: ejdUrl});
                        }
                    });
                } else {
                    let cadastralDistrictIdentifier = [];
                    let realPropertyKey = [];
                    this.state.data.map(x => {
                        cadastralDistrictIdentifier.push(x.properties.landsejerlavskode);
                        realPropertyKey.push(x.properties.matrikelnummer);
                    });
                    let searchParams = 'CadastralDistrictIdentifier=' + cadastralDistrictIdentifier.join(',') + '&RealPropertyKey=' + realPropertyKey.join(',');
                    let ejdUrl = 'ejdexpl://?mode=single&' + searchParams;
                    me.setState({ejdUrl: ejdUrl});
                }
            }

            onRemoveItem(e, index, nameToFind) {
                let layerToRemove;
                if (this.state.searchType === 'addr') {
                    markers.eachLayer((layer) => {
                        if (layer.options.title === nameToFind) {
                            layerToRemove = layer;
                        }
                    });
                    markers.removeLayer(layerToRemove);
                } else {
                    parcels.eachLayer((layer) => {
                        if (layer.feature.properties.ejerlavsnavn + ' ' + layer.feature.properties.matrikelnummer === nameToFind) {
                            layerToRemove = layer;
                        }
                    });
                    parcels.removeLayer(layerToRemove);
                }

                let data = this.state.data;
                data.splice(index, 1);

                this.setState({
                    active: this.state.active,
                    data: data
                })
                this.onSendToExplorer()
            }

            itemMouseEnter(e, nameToHighlight) {
                if (this.state.searchType === 'addr') {
                    $('.brevflet-marker-' + nameToHighlight).addClass('active');
                } else {
                    parcels.eachLayer((layer) => {
                        if (this.concatedName(layer.feature.properties.ejerlavsnavn + ' ' + layer.feature.properties.matrikelnummer) === nameToHighlight) {
                            layer.setStyle({weight: 4, fillOpacity: 0.5});
                        }
                    });
                }
            }

            itemMouseLeave(e, nameToHighlight) {
                if (this.state.searchType === 'addr') {
                    $('.brevflet-marker-' + nameToHighlight).removeClass('active');
                } else {
                    parcels.eachLayer((layer) => {
                        if (this.concatedName(layer.feature.properties.ejerlavsnavn + ' ' + layer.feature.properties.matrikelnummer) === nameToHighlight) {
                            parcels.resetStyle(layer);
                        }
                    });
                }
            }

            concatedName(name) {
                return name.replace(/[^A-Z0-9]+/ig, '')
            }

            render() {
                let listData = this.state.data.slice();
                if (listData.length >= 100) {
                    listData.splice(100, listData.length - 100);
                }
                let selected = listData.map((x, index) => {
                    let name;
                    if (this.state.searchType === 'addr') {
                        name = x.properties.vejnavn + ' ' + x.properties.husnr;
                    } else {
                        name = x.properties.ejerlavsnavn + ' ' + x.properties.matrikelnummer;
                    }
                    let concatedName = this.concatedName(name);
                    return (
                        <li key={index}
                            onMouseEnter={(e) => this.itemMouseEnter(e, concatedName)}
                            onMouseLeave={(e) => this.itemMouseLeave(e, concatedName)}
                            className="list-group-item address">
                            <div className="d-flex justify-content-between">
                                <div>{name}</div>
                                <button className="btn btn-outline-danger btn-sm"  onClick={(e) => this.onRemoveItem(e, index, name)}>
                                <i className="bi bi-trash "></i></button>
                            </div>
                        </li>
                    );
                })
                return (
                    <div role="tabpanel brevflet">
                        <div className="panel panel-default">
                            <div className="panel-body">
                                <span className="btn-group w-100 mb-3">
                                    <input className="btn-check" type="radio" name="search-type" id="search-type-addr"
                                           value="addr"
                                           checked={this.state.searchType === "addr"} onChange={this.handleTypeChange}/>
                                    <label htmlFor="search-type-addr" className="btn btn-sm btn-outline-secondary">
                                        Adresse
                                    </label>
                                    <input className="btn-check" type="radio" name="search-type" id="search-type-matr"
                                           value="matr"
                                           checked={this.state.searchType === "matr"} onChange={this.handleTypeChange}/>
                                    <label htmlFor="search-type-matr" className="btn btn-sm btn-outline-secondary">
                                        Matrikel
                                    </label>
                                </span>
                                <div className="form-group">
                                    <a target="_blank" href={this.state.ejdUrl} className="btn btn-primary mb-3">
                                        Send til Ejd Explorer</a>
                                </div>
                                <div className="selected-addresses">
                                    Valgte Addresser: {this.state.data.length}
                                </div>
                                <div className="list">
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

        utils.createMainTab(MODULE_NAME, "Brevflet", "Dette komponent kræver at ejd explorer er installeret. Vælg addresser til brug i Edj Explorer. Vælg ved at tegne med tegne værktøjet i kortet. (Der kan maks vises 100 addresser i menuen)", require('./../../../browser/modules/height')().max, 'bi bi-envelope', false, MODULE_NAME);

        // Append to DOM
        //==============
        try {
            ReactDOM.render(
                <BrevFlet/>,
                document.getElementById(MODULE_NAME)
            );
        } catch (e) {

        }

    }
};
